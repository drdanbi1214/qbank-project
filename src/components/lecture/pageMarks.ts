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
 * 엉뚱한 것을 지운다. 이미 저장된 글에는 tool 이 pen/highlight 인 것만 있어,
 * tool 을 보고 갈라내면 예전 글도 그대로 읽힌다.
 */
export type StrokeTool = 'pen' | 'highlight'
export type MarkTool = StrokeTool | 'text'

export type Stroke = {
  tool: StrokeTool
  color: string
  /** 이미지 가로폭 대비 굵기. 0.004 면 폭의 0.4%. */
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

export type PageMark = Stroke | PageText

export function isPageText(mark: PageMark): mark is PageText {
  return mark.tool === 'text'
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

export const TOOL_WIDTH: Record<StrokeTool, number> = {
  pen: 0.004,
  highlight: 0.03,
}

export const TOOL_OPACITY: Record<StrokeTool, number> = {
  pen: 1,
  highlight: 0.35,
}

/** 고를 수 있는 글자 크기(pt). */
export const TEXT_SIZES = [10, 12, 14, 18, 24, 32, 44] as const
export const DEFAULT_TEXT_SIZE = 18

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

/** 점 목록을 부드러운 선으로. 점이 하나뿐이면 그 자리에 점을 찍는다. */
export function toPath(points: number[], scaleX: number, scaleY: number): string {
  if (points.length < 2) return ''
  if (points.length === 2) {
    const x = points[0] * scaleX
    const y = points[1] * scaleY
    return `M ${x} ${y} L ${x + 0.01} ${y}`
  }
  let d = `M ${points[0] * scaleX} ${points[1] * scaleY}`
  for (let i = 2; i < points.length; i += 2) {
    d += ` L ${points[i] * scaleX} ${points[i + 1] * scaleY}`
  }
  return d
}

export function parsePageMarks(value: unknown): PageMark[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): PageMark[] => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const points = Array.isArray(record.points)
      ? record.points.filter((n): n is number => typeof n === 'number')
      : []
    if (points.length < 2) return []
    const color = typeof record.color === 'string' ? record.color : STROKE_COLORS[0]

    if (record.tool === 'text') {
      const text = typeof record.text === 'string' ? record.text.trim() : ''
      // 빈 글자는 화면에 아무것도 남기지 않으면서 자리만 차지한다.
      if (text === '') return []
      const size = typeof record.size === 'number' && record.size > 0 ? record.size : DEFAULT_TEXT_SIZE
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

    const tool: StrokeTool = record.tool === 'highlight' ? 'highlight' : 'pen'
    return [
      {
        tool,
        color,
        width: typeof record.width === 'number' ? record.width : TOOL_WIDTH[tool],
        points,
      },
    ]
  })
}
