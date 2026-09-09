import {
  createPageMarkId,
  isPageShape,
  isPageText,
  simplifyStroke,
  type PageMark,
  type Stroke,
} from '@/components/lecture/pageMarks'

export type NormalizedPoint = [number, number]

export type MarkBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

function pointPairs(mark: PageMark): NormalizedPoint[] {
  if (isPageText(mark)) return [[mark.points[0], mark.points[1]]]
  if (isPageShape(mark)) {
    const [x1, y1, x2, y2] = mark.points
    return [
      [x1, y1],
      [x2, y1],
      [x2, y2],
      [x1, y2],
      [(x1 + x2) / 2, (y1 + y2) / 2],
    ]
  }
  const points: NormalizedPoint[] = []
  for (let index = 0; index < mark.points.length; index += 2) {
    points.push([mark.points[index], mark.points[index + 1]])
  }
  return points
}

export function selectedMarkBounds(marks: PageMark[], selected: readonly number[]): MarkBounds | null {
  const points = selected.flatMap((index) => {
    const mark = marks[index]
    return mark ? pointPairs(mark) : []
  })
  if (points.length === 0) return null
  return {
    left: Math.min(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    right: Math.max(...points.map(([x]) => x)),
    bottom: Math.max(...points.map(([, y]) => y)),
  }
}

export function translateSelectedMarks(
  marks: PageMark[],
  selected: readonly number[],
  dx: number,
  dy: number,
): PageMark[] {
  const selectedSet = new Set(selected)
  return marks.map((mark, index) => {
    if (!selectedSet.has(index)) return mark
    const points = [...mark.points]
    for (let point = 0; point < points.length; point += 2) {
      points[point] += dx
      points[point + 1] += dy
    }
    return { ...mark, points } as PageMark
  })
}

function pointInPolygon(point: NormalizedPoint, polygon: readonly NormalizedPoint[]): boolean {
  if (polygon.length < 3) return false
  let inside = false
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [x, y] = polygon[current]
    const [previousX, previousY] = polygon[previous]
    const crosses =
      (y > point[1]) !== (previousY > point[1]) &&
      point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y || Number.EPSILON) + x
    if (crosses) inside = !inside
  }
  return inside
}

function orientation(a: NormalizedPoint, b: NormalizedPoint, c: NormalizedPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function segmentsIntersect(
  a: NormalizedPoint,
  b: NormalizedPoint,
  c: NormalizedPoint,
  d: NormalizedPoint,
): boolean {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1])
  ) {
    return false
  }
  const abC = orientation(a, b, c)
  const abD = orientation(a, b, d)
  const cdA = orientation(c, d, a)
  const cdB = orientation(c, d, b)
  return abC * abD <= 0 && cdA * cdB <= 0
}

function markCrossesPolygon(mark: PageMark, polygon: readonly NormalizedPoint[]): boolean {
  const points = pointPairs(mark)
  if (points.some((point) => pointInPolygon(point, polygon))) return true
  if (isPageText(mark) || points.length < 2) return false

  const markSegments: [NormalizedPoint, NormalizedPoint][] = []
  if (isPageShape(mark)) {
    for (let index = 0; index < 4; index += 1) {
      markSegments.push([points[index], points[(index + 1) % 4]])
    }
  } else {
    for (let index = 1; index < points.length; index += 1) {
      markSegments.push([points[index - 1], points[index]])
    }
  }
  for (let edge = 0; edge < polygon.length; edge += 1) {
    const from = polygon[edge]
    const to = polygon[(edge + 1) % polygon.length]
    if (markSegments.some(([a, b]) => segmentsIntersect(a, b, from, to))) return true
  }
  return false
}

export function marksInsideLasso(
  marks: PageMark[],
  polygon: readonly NormalizedPoint[],
): number[] {
  if (polygon.length < 3) return []
  return marks.flatMap((mark, index) => (markCrossesPolygon(mark, polygon) ? [index] : []))
}

function pointToSegmentDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const progress = Math.min(Math.max(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0), 1)
  return Math.hypot(px - (x1 + progress * dx), py - (y1 + progress * dy))
}

function segmentToSegmentDistance(
  a: NormalizedPoint,
  b: NormalizedPoint,
  c: NormalizedPoint,
  d: NormalizedPoint,
): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(
    pointToSegmentDistance(a[0], a[1], c[0], c[1], d[0], d[1]),
    pointToSegmentDistance(b[0], b[1], c[0], c[1], d[0], d[1]),
    pointToSegmentDistance(c[0], c[1], a[0], a[1], b[0], b[1]),
    pointToSegmentDistance(d[0], d[1], a[0], a[1], b[0], b[1]),
  )
}

function shapeSegments(mark: Extract<PageMark, { tool: 'rectangle' | 'star' }>): Array<[NormalizedPoint, NormalizedPoint]> {
  const [x1, y1, x2, y2] = mark.points
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  let points: NormalizedPoint[]
  if (mark.tool === 'rectangle') {
    points = [[left, top], [right, top], [right, bottom], [left, bottom]]
  } else {
    const centerX = (left + right) / 2
    const centerY = (top + bottom) / 2
    points = Array.from({ length: 10 }, (_, index): NormalizedPoint => {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5
      const radius = index % 2 === 0 ? 1 : 0.42
      return [
        centerX + Math.cos(angle) * ((right - left) / 2) * radius,
        centerY + Math.sin(angle) * ((bottom - top) / 2) * radius,
      ]
    })
  }
  return points.map((point, index) => [point, points[(index + 1) % points.length]])
}

function wholeMarkHitAlong(
  mark: PageMark,
  from: NormalizedPoint,
  to: NormalizedPoint,
  scaleX: number,
  scaleY: number,
  radiusPx: number,
): boolean {
  const cursorFrom: NormalizedPoint = [from[0] * scaleX, from[1] * scaleY]
  const cursorTo: NormalizedPoint = [to[0] * scaleX, to[1] * scaleY]
  if (isPageText(mark)) {
    const anchor: NormalizedPoint = [mark.points[0] * scaleX, mark.points[1] * scaleY]
    return pointToSegmentDistance(
      anchor[0],
      anchor[1],
      cursorFrom[0],
      cursorFrom[1],
      cursorTo[0],
      cursorTo[1],
    ) <= radiusPx * 1.4
  }
  if (!isPageShape(mark)) return false
  const threshold = radiusPx + (mark.width * scaleX) / 2
  return shapeSegments(mark).some(([shapeFrom, shapeTo]) =>
    segmentToSegmentDistance(
      cursorFrom,
      cursorTo,
      [shapeFrom[0] * scaleX, shapeFrom[1] * scaleY],
      [shapeTo[0] * scaleX, shapeTo[1] * scaleY],
    ) <= threshold,
  )
}

function eraseStrokeAlong(
  mark: Stroke,
  from: NormalizedPoint,
  to: NormalizedPoint,
  scaleX: number,
  scaleY: number,
  radiusPx: number,
): { pieces: Stroke[]; changed: boolean } {
  const source = pointPairs(mark)
  if (source.length === 0) return { pieces: [], changed: true }
  const hasPressure = mark.pressures?.length === source.length
  const pressureExpansion = mark.tool !== 'highlight' && hasPressure ? 1.45 : 1
  const threshold = radiusPx + (mark.width * scaleX * pressureExpansion) / 2
  const cursorFrom: NormalizedPoint = [from[0] * scaleX, from[1] * scaleY]
  const cursorTo: NormalizedPoint = [to[0] * scaleX, to[1] * scaleY]
  const hit = source.length === 1
    ? pointToSegmentDistance(
        source[0][0] * scaleX,
        source[0][1] * scaleY,
        cursorFrom[0],
        cursorFrom[1],
        cursorTo[0],
        cursorTo[1],
      ) <= threshold
    : source.slice(1).some((point, index) =>
        segmentToSegmentDistance(
          cursorFrom,
          cursorTo,
          [source[index][0] * scaleX, source[index][1] * scaleY],
          [point[0] * scaleX, point[1] * scaleY],
        ) <= threshold,
      )
  if (!hit) return { pieces: [mark], changed: false }

  const dense: { point: NormalizedPoint; pressure?: number }[] = []

  if (source.length === 1) {
    dense.push({ point: source[0], pressure: hasPressure ? mark.pressures![0] : undefined })
  } else {
    for (let index = 1; index < source.length; index += 1) {
      const from = source[index - 1]
      const to = source[index]
      const lengthPx = Math.hypot((to[0] - from[0]) * scaleX, (to[1] - from[1]) * scaleY)
      const steps = Math.max(1, Math.ceil(lengthPx / 3))
      for (let step = index === 1 ? 0 : 1; step <= steps; step += 1) {
        const progress = step / steps
        const pressure = hasPressure
          ? mark.pressures![index - 1] +
            (mark.pressures![index] - mark.pressures![index - 1]) * progress
          : undefined
        dense.push({
          point: [
            from[0] + (to[0] - from[0]) * progress,
            from[1] + (to[1] - from[1]) * progress,
          ],
          pressure,
        })
      }
    }
  }

  const erased = dense.map(({ point }) =>
    pointToSegmentDistance(
      point[0] * scaleX,
      point[1] * scaleY,
      cursorFrom[0],
      cursorFrom[1],
      cursorTo[0],
      cursorTo[1],
    ) <= threshold,
  )
  if (!erased.some(Boolean)) return { pieces: [mark], changed: false }

  const runs: typeof dense[] = []
  let run: typeof dense = []
  dense.forEach((sample, index) => {
    if (erased[index]) {
      if (run.length > 1) runs.push(run)
      run = []
      return
    }
    run.push(sample)
  })
  if (run.length > 1) runs.push(run)

  return {
    changed: true,
    pieces: runs.map((samples, index) =>
      simplifyStroke({
        ...mark,
        id: index === 0 && mark.id ? mark.id : createPageMarkId(),
        points: samples.flatMap(({ point }) => point),
        ...(hasPressure ? { pressures: samples.map(({ pressure }) => pressure ?? 0.5) } : {}),
      }, 0.0008),
    ),
  }
}

export function erasePageMarksAt(
  marks: PageMark[],
  at: NormalizedPoint,
  scaleX: number,
  scaleY: number,
  radiusPx: number,
): { marks: PageMark[]; changed: boolean } {
  return erasePageMarksAlong(marks, at, at, scaleX, scaleY, radiusPx)
}

/** 포인터 이동 구간 전체를 한 번에 판정해 빠르게 움직여도 필기 사이를 건너뛰지 않는다. */
export function erasePageMarksAlong(
  marks: PageMark[],
  from: NormalizedPoint,
  to: NormalizedPoint,
  scaleX: number,
  scaleY: number,
  radiusPx: number,
): { marks: PageMark[]; changed: boolean } {
  let changed = false
  const next = marks.flatMap((mark): PageMark[] => {
    if (isPageText(mark) || isPageShape(mark)) {
      if (!wholeMarkHitAlong(mark, from, to, scaleX, scaleY, radiusPx)) return [mark]
      changed = true
      return []
    }
    const result = eraseStrokeAlong(mark, from, to, scaleX, scaleY, radiusPx)
    changed ||= result.changed
    return result.pieces
  })
  return { marks: next, changed }
}
