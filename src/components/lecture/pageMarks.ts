/**
 * 강의록 쪽 위에 남긴 표시 — 덧그린 자국과 얹은 글자.
 *
 * 이미지에 구워 넣지 않고 좌표로 따로 담는다. 구워 버리면 나중에 한 획만
 * 지우거나 색을 바꿀 수 없고, 크기를 줄일 때 같이 뭉개진다. 좌표로 두면 어느
 * 크기로 그리든 선명하고 인쇄에도 그대로 나간다.
 *
 * 좌표는 이미지 가로폭을 1로 본 비율이다. 카드 폭을 바꿔도 표시가 따라 움직인다.
 * 점은 [x1, y1, x2, y2, …] 로 눕혀 담는다 — 객체로 담으면 글 하나에 자국이
 * 수십 개일 때 본문 JSON 이 몇 배로 불어난다.
 *
 * 자국과 글자를 한 배열에 섞어 담는다. 따로 두면 넣은 순서를 잃어 되돌리기가
 * 엉뚱한 것을 지운다. tool 을 보고 선·도형·글자를 갈라내며, 이미 저장된
 * pen/highlight 표시도 같은 방식으로 그대로 읽힌다.
 */
export type StrokeTool = 'pen' | 'highlight' | 'pencil'
export type ShapeTool = 'rectangle' | 'star'
export type MarkTool = StrokeTool | ShapeTool | 'text'

export type Stroke = {
  tool: StrokeTool
  color: string
  /** 이미지 가로폭 대비 굵기. 0.004 면 폭의 0.4%. */
  width: number
  points: number[]
  /** 점 한 쌍마다 대응하는 0~1 압력. 예전 필기에는 없을 수 있다. */
  pressures?: number[]
}

export type PageShape = {
  tool: ShapeTool
  color: string
  /** 테두리 굵기. points는 시작점과 끝점 [x1, y1, x2, y2]다. */
  width: number
  points: number[]
}

export type PageText = {
  tool: 'text'
  color: string
  /** 글자 상자의 배경과 테두리. transparent 면 그리지 않는다. */
  background: string
  borderColor: string
  /** 글자 크기(pt). 자리는 [x, y] 한 쌍이며 글자의 왼쪽 위를 가리킨다. */
  size: number
  text: string
  points: number[]
}

export type PageMark = Stroke | PageShape | PageText

export function isPageText(mark: PageMark): mark is PageText {
  return mark.tool === 'text'
}

export function isPageShape(mark: PageMark): mark is PageShape {
  return mark.tool === 'rectangle' || mark.tool === 'star'
}

export const STROKE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#111827'] as const

/** 글자 상자 배경. 살짝 투명하게 두어 강의록 원문이 완전히 가려지지 않게 한다. */
export const TEXT_BOX_BACKGROUNDS = [
  { value: 'transparent', label: '배경 없음' },
  { value: '#ffffffeb', label: '흰색' },
  { value: '#fef3c7eb', label: '노란색' },
  { value: '#dcfce7eb', label: '연두색' },
  { value: '#dbeafeeb', label: '하늘색' },
  { value: '#fce7f3eb', label: '분홍색' },
  { value: '#e2e8f0eb', label: '회색' },
] as const

/** 글자 상자 테두리. 글자색과 별도로 고를 수 있다. */
export const TEXT_BOX_BORDERS = [
  { value: 'transparent', label: '테두리 없음' },
  { value: '#111827', label: '검정색' },
  { value: '#ffffff', label: '흰색' },
  { value: '#e11d48', label: '빨간색' },
  { value: '#2563eb', label: '파란색' },
  { value: '#16a34a', label: '초록색' },
  { value: '#f59e0b', label: '주황색' },
] as const

export const DEFAULT_TEXT_BACKGROUND = TEXT_BOX_BACKGROUNDS[0].value
export const DEFAULT_TEXT_BORDER = TEXT_BOX_BORDERS[0].value

export const TOOL_WIDTH: Record<StrokeTool | ShapeTool, number> = {
  pen: 0.004,
  highlight: 0.03,
  pencil: 0.0065,
  rectangle: 0.004,
  star: 0.005,
}

export const TOOL_OPACITY: Record<StrokeTool | ShapeTool, number> = {
  pen: 1,
  highlight: 0.35,
  pencil: 0.82,
  rectangle: 1,
  star: 1,
}

/** 고를 수 있는 글자 크기(pt). */
export const TEXT_SIZES = [10, 12, 14, 18, 24, 32, 44] as const
export const DEFAULT_TEXT_SIZE = 18
const MAX_MARKS_PER_PAGE = 2_000
const MAX_POINT_VALUES_PER_MARK = 40_000

/**
 * pt 를 좌표계 단위로 옮길 때 기준 삼는 쪽 폭.
 *
 * 강의록마다 실제 쪽 크기가 달라(16:9 슬라이드 960pt, 4:3 720pt, A4 가로 842pt)
 * 어느 하나를 골라야 한다. 가장 흔한 16:9 를 기준으로 잡았으므로 4:3 강의록에서는
 * 같은 pt 라도 조금 크게 보인다. 어차피 카드 폭에 따라 함께 커지고 작아지는
 * 상대 크기라, pt 는 "얼마나 큰 글씨인지" 를 가리키는 눈금으로 쓴다.
 */
export const NOMINAL_PT_WIDTH = 960

/**
 * 손이 떨려 생긴 촘촘한 점을 솎는다.
 *
 * 그대로 담으면 한 획에 수백 점이 들어가 본문이 무거워진다. 화면에서 보이는
 * 모양은 그대로면서 점 수만 크게 준다.
 */
export function simplify(points: number[], tolerance = 0.002): number[] {
  if (points.length <= 4) return points
  const kept = [points[0], points[1]]
  for (let i = 2; i < points.length - 2; i += 2) {
    const dx = points[i] - kept[kept.length - 2]
    const dy = points[i + 1] - kept[kept.length - 1]
    if (Math.hypot(dx, dy) >= tolerance) kept.push(points[i], points[i + 1])
  }
  kept.push(points[points.length - 2], points[points.length - 1])
  return kept
}

/** 좌표를 솎을 때 Pencil 압력도 같은 점과 함께 보존한다. */
export function simplifyStroke(stroke: Stroke, tolerance = 0.0015): Stroke {
  if (stroke.points.length <= 4) return stroke
  const hasPressure = stroke.pressures?.length === stroke.points.length / 2
  const keptPoints = [stroke.points[0], stroke.points[1]]
  const keptPressures = hasPressure ? [stroke.pressures![0]] : undefined

  for (let i = 2; i < stroke.points.length - 2; i += 2) {
    const dx = stroke.points[i] - keptPoints[keptPoints.length - 2]
    const dy = stroke.points[i + 1] - keptPoints[keptPoints.length - 1]
    const pressureIndex = i / 2
    const pressureChanged =
      hasPressure &&
      Math.abs(stroke.pressures![pressureIndex] - keptPressures![keptPressures!.length - 1]) >= 0.06
    if (Math.hypot(dx, dy) >= tolerance || pressureChanged) {
      keptPoints.push(stroke.points[i], stroke.points[i + 1])
      keptPressures?.push(stroke.pressures![pressureIndex])
    }
  }

  keptPoints.push(stroke.points[stroke.points.length - 2], stroke.points[stroke.points.length - 1])
  keptPressures?.push(stroke.pressures![stroke.pressures!.length - 1])
  return { ...stroke, points: keptPoints, ...(keptPressures ? { pressures: keptPressures } : {}) }
}

/** 점 목록을 중간점 곡선으로 이어, 저장된 점 사이의 각이 보이지 않게 한다. */
export function toPath(points: number[], scaleX: number, scaleY: number): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    const x = points[0] * scaleX
    const y = points[1] * scaleY
    return `M ${x} ${y} L ${x + 0.01} ${y}`
  }
  let d = `M ${points[0] * scaleX} ${points[1] * scaleY}`
  for (let i = 2; i < points.length - 2; i += 2) {
    const x = points[i] * scaleX
    const y = points[i + 1] * scaleY
    const nextX = points[i + 2] * scaleX
    const nextY = points[i + 3] * scaleY
    d += ` Q ${x} ${y} ${(x + nextX) / 2} ${(y + nextY) / 2}`
  }
  const last = points.length - 2
  const lastX = points[last] * scaleX
  const lastY = points[last + 1] * scaleY
  return `${d} Q ${lastX} ${lastY} ${lastX} ${lastY}`
}

/**
 * 압력과 곡선 보정을 적용한 펜 획.
 *
 * Pencil 압력이 있으면 그 값을 쓰고, 마우스·손가락·예전 필기처럼
 * 압력이 없으면 이동 속도로 굵기를 자연스럽게 보완한다.
 */
export function toPressurePenPath(mark: Stroke, scaleX: number, scaleY: number): string {
  if (mark.tool !== 'pen' && mark.tool !== 'pencil') return ''
  const hasPressure = mark.pressures?.length === mark.points.length / 2
  const isPencil = mark.tool === 'pencil'
  const input = Array.from({ length: mark.points.length / 2 }, (_, index) => {
    const point = [mark.points[index * 2] * scaleX, mark.points[index * 2 + 1] * scaleY]
    return hasPressure ? [...point, mark.pressures![index]] : point
  })
  const outline = getStroke(input, {
    size: mark.width * scaleX,
    thinning: hasPressure ? (isPencil ? 0.34 : 0.45) : isPencil ? 0.2 : 0.32,
    smoothing: isPencil ? 0.62 : 0.72,
    // 값이 높을수록 손을 더 늦게 따라와 필기감이 둥해진다.
    // 지연은 줄이면서 미세한 떨림만 곡선 보정에 맡긴다.
    streamline: isPencil ? 0.12 : 0.18,
    simulatePressure: !hasPressure,
    easing: (pressure) => pressure ** (isPencil ? 0.82 : 0.7),
    last: true,
  })
  if (outline.length === 0) return ''
  if (outline.length === 1) return `M ${outline[0][0]} ${outline[0][1]} Z`
  if (outline.length < 4) return ''

  const first = outline[0]
  const second = outline[1]
  const third = outline[2]
  let path = `M ${first[0]} ${first[1]} Q ${second[0]} ${second[1]} ${(second[0] + third[0]) / 2} ${(second[1] + third[1]) / 2} T`
  // 외곽점 자체를 제어점으로 계속 쓰면 급한 굴곡에서 선이 교차해 하얀 틈이
  // 생긴다. 중간점을 잇는 곡선은 같은 모양을 유지하면서 교차를 피한다.
  for (let index = 2; index < outline.length - 1; index += 1) {
    const point = outline[index]
    const next = outline[index + 1]
    path += ` ${(point[0] + next[0]) / 2} ${(point[1] + next[1]) / 2}`
  }
  return `${path} Z`
}

export function parsePageMarks(value: unknown): PageMark[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_MARKS_PER_PAGE).flatMap((item): PageMark[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (
      !Array.isArray(record.points) ||
      record.points.length < 2 ||
      record.points.length % 2 !== 0 ||
      record.points.length > MAX_POINT_VALUES_PER_MARK ||
      record.points.some((number) => typeof number !== 'number' || !Number.isFinite(number))
    ) {
      return []
    }
    const points = (record.points as number[]).map((number) =>
      Math.min(Math.max(number, -0.25), 1.25),
    )
    const color =
      typeof record.color === 'string' && record.color.length <= 64
        ? record.color
        : STROKE_COLORS[0]

    if (record.tool === 'text') {
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      // 빈 글자는 화면에 아무것도 남기지 않으면서 자리만 차지한다.
      if (text === '') return []
      const size =
        typeof record.size === 'number' && Number.isFinite(record.size) && record.size > 0
          ? Math.min(record.size, 200)
          : DEFAULT_TEXT_SIZE
      const background = TEXT_BOX_BACKGROUNDS.some((item) => item.value === record.background)
        ? String(record.background)
        : DEFAULT_TEXT_BACKGROUND
      const borderColor = TEXT_BOX_BORDERS.some((item) => item.value === record.borderColor)
        ? String(record.borderColor)
        : DEFAULT_TEXT_BORDER
      return [
        {
          tool: 'text' as const,
          color,
          background,
          borderColor,
          size,
          text,
          points: [points[0], points[1]],
        },
      ]
    }

    if (record.tool === 'rectangle' || record.tool === 'star') {
      if (points.length < 4) return []
      const tool = record.tool
      return [
        {
          tool,
          color,
          width: validMarkWidth(record.width, TOOL_WIDTH[tool]),
          points: points.slice(0, 4),
        },
      ]
    }

    if (record.tool !== 'pen' && record.tool !== 'highlight' && record.tool !== 'pencil') return []
    const tool: StrokeTool = record.tool
    const pressures = Array.isArray(record.pressures)
      ? record.pressures.filter(
          (pressure): pressure is number =>
            typeof pressure === 'number' && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1,
        )
      : []
    return [
      {
        tool,
        color,
        width: validMarkWidth(record.width, TOOL_WIDTH[tool]),
        points,
        ...(tool !== 'highlight' && pressures.length === points.length / 2 ? { pressures } : {}),
      },
    ]
  })
}

function validMarkWidth(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.0005 && value <= 0.2
    ? value
    : fallback
}
import { getStroke } from 'perfect-freehand'
