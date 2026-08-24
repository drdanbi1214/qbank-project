export type PageCrop = {
  /** 원본 이미지 가로·세로를 0~1로 본 상대 좌표다. */
  x: number
  y: number
  width: number
  height: number
}

export const FULL_PAGE_CROP: PageCrop = { x: 0, y: 0, width: 1, height: 1 }
export const MIN_CROP_SIZE = 0.05

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 저장된 JSON이 유효한 자르기 영역인지 확인하고 범위 밖 값은 안전하게 고친다. */
export function pageCropOf(value: unknown): PageCrop | null {
  const record = recordOf(value)
  if (!record) return null

  const rawX = finite(record.x)
  const rawY = finite(record.y)
  const rawWidth = finite(record.width)
  const rawHeight = finite(record.height)
  if (rawX === null || rawY === null || rawWidth === null || rawHeight === null) return null

  const x = clamp(rawX, 0, 1 - MIN_CROP_SIZE)
  const y = clamp(rawY, 0, 1 - MIN_CROP_SIZE)
  const width = clamp(rawWidth, MIN_CROP_SIZE, 1 - x)
  const height = clamp(rawHeight, MIN_CROP_SIZE, 1 - y)

  // 전체 페이지와 사실상 같으면 값을 없애 기존 문서와 같은 경로로 그린다.
  if (x < 0.0005 && y < 0.0005 && width > 0.9995 && height > 0.9995) return null
  return { x, y, width, height }
}

export function roundedPageCrop(value: PageCrop): PageCrop | null {
  const rounded = {
    x: Math.round(value.x * 10_000) / 10_000,
    y: Math.round(value.y * 10_000) / 10_000,
    width: Math.round(value.width * 10_000) / 10_000,
    height: Math.round(value.height * 10_000) / 10_000,
  }
  return pageCropOf(rounded)
}
