/**
 * 시험지 내보내기 화면의 보기 설정.
 *
 * 같은 사람이 같은 모양으로 여러 번 뽑는 일이 많아 브라우저에 남긴다. 저장된
 * 값은 지난 판에서 온 것이거나 사람이 손댈 수도 있으므로, 읽을 때 범위 밖이면
 * 기본값으로 되돌린다 — 화면의 슬라이더가 가진 범위와 같은 값을 쓴다.
 */
export type PrintLayout = 'stack' | 'split' | 'separate'

export type PrintSettings = {
  layout: PrintLayout
  /** A4 가로로 돌렸는지 */
  landscape: boolean
  /** 좌우 여백 (mm) */
  margin: number
  /** 글자 배율 (1 이 지금까지의 크기) */
  scale: number
  /** 좌우 분할에서 문제가 차지하는 비율 (%) */
  splitRatio: number
  /** 줄 간격 배수 (1 이 지금까지의 간격) */
  leading: number
  /** 문제 사진의 최대 너비 (%) */
  imageWidth: number
  /** 한 쪽에 세울 단 수 */
  columns: number
  /** 문항마다 새 단에서 시작할지. 끄면 앞 문항에 이어 흐른다. */
  onePerColumn: boolean
  /** 단과 단 사이에 구분선을 그을지 */
  columnRule: boolean
}

export const PRINT_SETTINGS_RANGE = {
  // 5mm 는 종이 가장자리에 글이 닿아 잘려 나온다. 8mm 아래로는 내리지 않는다.
  margin: { min: 8, max: 30 },
  scale: { min: 0.7, max: 1.5 },
  leading: { min: 0.75, max: 1.3 },
  splitRatio: { min: 20, max: 80 },
  columns: { min: 1, max: 3 },
  imageWidth: { min: 30, max: 100 },
} as const

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  layout: 'stack',
  landscape: false,
  margin: 15,
  scale: 1,
  leading: 1,
  splitRatio: 50,
  imageWidth: 70,
  columns: 1,
  onePerColumn: true,
  columnRule: true,
}

/** 브라우저를 같이 쓰는 경우가 있어 계정별로 나눠 담는다. */
export function printSettingsKey(userId: string): string {
  return `qbank:print-settings:${userId}`
}

function bounded(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function parsePrintSettings(raw: string | null): PrintSettings {
  if (!raw) return { ...DEFAULT_PRINT_SETTINGS }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ...DEFAULT_PRINT_SETTINGS }
  }
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_PRINT_SETTINGS }

  const row = value as Record<string, unknown>
  const { margin, scale, leading, splitRatio, columns, imageWidth } = PRINT_SETTINGS_RANGE
  return {
    layout: row.layout === 'split' || row.layout === 'separate' ? row.layout : 'stack',
    landscape: row.landscape === true,
    margin: Math.round(bounded(row.margin, margin.min, margin.max, DEFAULT_PRINT_SETTINGS.margin)),
    // 배율은 5% 단위라 반올림하면 슬라이더 눈금과 어긋나지 않는다.
    scale:
      Math.round(bounded(row.scale, scale.min, scale.max, DEFAULT_PRINT_SETTINGS.scale) * 20) / 20,
    leading:
      Math.round(bounded(row.leading, leading.min, leading.max, DEFAULT_PRINT_SETTINGS.leading) * 20) /
      20,
    splitRatio: Math.round(
      bounded(row.splitRatio, splitRatio.min, splitRatio.max, DEFAULT_PRINT_SETTINGS.splitRatio),
    ),
    imageWidth: Math.round(
      bounded(row.imageWidth, imageWidth.min, imageWidth.max, DEFAULT_PRINT_SETTINGS.imageWidth),
    ),
    columns: Math.round(
      bounded(row.columns, columns.min, columns.max, DEFAULT_PRINT_SETTINGS.columns),
    ),
    // 저장된 적이 없으면 켜 둔다. 2단을 고르는 까닭이 대개 문항마다 단을 나누는
    // 것이라, 끄고 시작하면 무엇이 달라졌는지 알기 어렵다.
    onePerColumn: row.onePerColumn !== false,
    columnRule: row.columnRule !== false,
  }
}
