/**
 * 강의록 쪽 위에 덧그린 자국.
 *
 * 그림을 이미지에 구워 넣지 않고 좌표로 따로 담는다. 구워 버리면 나중에 한 획만
 * 지우거나 색을 바꿀 수 없고, 크기를 줄일 때 같이 뭉개진다. 좌표로 두면 어느
 * 크기로 그리든 선명하고 인쇄에도 그대로 나간다.
 *
 * 좌표는 이미지 가로폭을 1로 본 비율이다. 카드 폭을 바꿔도 자국이 따라 움직인다.
 * 점은 [x1, y1, x2, y2, …] 로 눕혀 담는다 — 객체로 담으면 글 하나에 자국이
 * 수십 개일 때 본문 JSON 이 몇 배로 불어난다.
 */
export type StrokeTool = 'pen' | 'highlight'

export type Stroke = {
  tool: StrokeTool
  color: string
  /** 이미지 가로폭 대비 굵기. 0.004 면 폭의 0.4%. */
  width: number
  points: number[]
}

export const STROKE_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#111827'] as const

export const TOOL_WIDTH: Record<StrokeTool, number> = {
  pen: 0.004,
  highlight: 0.03,
}

export const TOOL_OPACITY: Record<StrokeTool, number> = {
  pen: 1,
  highlight: 0.35,
}

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

export function parseStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const points = Array.isArray(record.points)
      ? record.points.filter((n): n is number => typeof n === 'number')
      : []
    if (points.length < 2) return []
    const tool: StrokeTool = record.tool === 'highlight' ? 'highlight' : 'pen'
    return [
      {
        tool,
        color: typeof record.color === 'string' ? record.color : STROKE_COLORS[0],
        width: typeof record.width === 'number' ? record.width : TOOL_WIDTH[tool],
        points,
      },
    ]
  })
}
