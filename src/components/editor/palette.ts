/**
 * 본문에서 쓰는 색 팔레트와, 밖에서 붙여넣은 색을 여기에 맞추는 규칙.
 *
 * 문서 JSON 은 여러 사람이 나눠 쓰고 그대로 다시 읽히므로 임의 CSS 를 담을 수
 * 없다. 그렇다고 모르는 색을 버리기만 하면 남의 자료에서 가져온 강조가 통째로
 * 사라지거나, 색 없는 <mark> 가 되어 원본에 없던 노란 형광펜이 생긴다.
 * 그래서 버리는 대신 가장 가까운 팔레트 색으로 맞춘다.
 */

export const NOTE_TEXT_COLORS = [
  { label: '빨강 글씨', color: '#cc1616', className: 'text-marker-red' },
  { label: '파랑 글씨', color: '#2563eb', className: 'text-blue-600' },
  { label: '초록 글씨', color: '#059669', className: 'text-emerald-600' },
  { label: '보라 글씨', color: '#9333ea', className: 'text-purple-600' },
  { label: '주황 글씨', color: '#ea580c', className: 'text-orange-600' },
] as const

export const NOTE_HIGHLIGHTS = [
  { label: '노랑 형광펜', color: 'rgba(253, 224, 71, 0.55)', className: 'bg-amber-300' },
  { label: '초록 형광펜', color: 'rgba(110, 231, 183, 0.55)', className: 'bg-emerald-300' },
  { label: '하늘 형광펜', color: 'rgba(125, 211, 252, 0.55)', className: 'bg-sky-300' },
  { label: '분홍 형광펜', color: 'rgba(249, 168, 212, 0.55)', className: 'bg-pink-300' },
] as const

export const TEXT_COLOR_SET: ReadonlySet<string> = new Set(NOTE_TEXT_COLORS.map((item) => item.color))
export const HIGHLIGHT_SET: ReadonlySet<string> = new Set(NOTE_HIGHLIGHTS.map((item) => item.color))

type Rgb = [number, number, number]

/**
 * 팔레트 색의 색상(hue). 사람이 "파란 글씨" 라고 할 때 보는 건 밝기가 아니라
 * 색상이다. RGB 거리로 재면 워드의 짙은 남색(#1F4E79)이 초록으로, 노션의
 * 빨강(#E03E3E)이 주황으로 가버린다.
 */
const TEXT_TARGETS: { color: string; hue: number }[] = [
  { color: '#cc1616', hue: 0 },
  { color: '#ea580c', hue: 24 },
  { color: '#059669', hue: 162 },
  { color: '#2563eb', hue: 221 },
  { color: '#9333ea', hue: 276 },
]

const HIGHLIGHT_TARGETS: { color: string; hue: number }[] = [
  { color: 'rgba(253, 224, 71, 0.55)', hue: 51 },
  { color: 'rgba(110, 231, 183, 0.55)', hue: 155 },
  { color: 'rgba(125, 211, 252, 0.55)', hue: 200 },
  { color: 'rgba(249, 168, 212, 0.55)', hue: 327 },
]

/**
 * 어떤 CSS 색이든 rgb 로 바꾼다.
 *
 * 이름 색(blue), #abc, rgb(), hsl() 이 모두 섞여 들어오므로 canvas 의 색
 * 정규화에 맡긴다. 브라우저가 해석하지 못하면 값이 그대로 남으니 그걸로 걸러낸다.
 */
let probe: CanvasRenderingContext2D | null | undefined

function toRgb(value: string): Rgb | null {
  const input = value.trim()
  if (input === '' || input === 'transparent' || input === 'currentcolor') return null

  if (probe === undefined) probe = document.createElement('canvas').getContext('2d')
  if (!probe) return null

  probe.fillStyle = '#000000'
  probe.fillStyle = input
  const normalized = String(probe.fillStyle)
  // 해석 실패 시 fillStyle 이 바뀌지 않는다. 진짜 검정과 구분하려고 한 번 더 본다.
  if (normalized === '#000000' && !/^(#0{3,8}$|black$|rgba?\(\s*0\s*,\s*0\s*,\s*0)/i.test(input)) {
    return null
  }

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }

  const match = /rgba?\(([^)]+)\)/.exec(normalized)
  if (!match) return null
  const parts = match[1].split(',').map((part) => Number(part))
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null
  const alpha = parts[3] ?? 1
  if (alpha < 0.08) return null // 사실상 투명

  // 반투명은 흰 바탕에 얹은 색으로 본다.
  return [0, 1, 2].map((i) => Math.round(parts[i] * alpha + 255 * (1 - alpha))) as Rgb
}

/** 색상(0~360), 채도(0~1), 밝기(0~1). */
function toHsl([r, g, b]: Rgb): { hue: number; saturation: number; lightness: number } {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) return { hue: 0, saturation: 0, lightness }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1))
  let hue: number
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4

  return { hue: (hue * 60 + 360) % 360, saturation, lightness }
}

/** 색상환은 원형이라 0도와 350도가 가깝다. */
function hueGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % 360
  return gap > 180 ? 360 - gap : gap
}

function nearest(hue: number, targets: { color: string; hue: number }[]): string {
  return targets.reduce((best, target) =>
    hueGap(hue, target.hue) < hueGap(hue, best.hue) ? target : best,
  ).color
}

/**
 * 붙여넣은 글자색을 팔레트 색으로 맞춘다.
 * 검정·회색이면 null 을 돌려주어 색을 입히지 않는다.
 */
export function snapTextColor(value: string): string | null {
  const rgb = toRgb(value)
  if (!rgb) return null
  const { hue, saturation, lightness } = toHsl(rgb)
  // 채도가 낮거나 거의 검정이면 본문 기본색으로 둔다.
  if (saturation < 0.18 || lightness < 0.1 || lightness > 0.92) return null
  return nearest(hue, TEXT_TARGETS)
}

/**
 * 붙여넣은 배경색을 형광펜 색으로 맞춘다.
 * 흰색·회색에 가까우면 강조가 아니라 그냥 바탕이므로 null 을 돌려준다.
 */
export function snapHighlightColor(value: string): string | null {
  const rgb = toRgb(value)
  if (!rgb) return null
  const { hue, saturation, lightness } = toHsl(rgb)
  if (saturation < 0.12 || lightness > 0.96 || lightness < 0.08) return null
  return nearest(hue, HIGHLIGHT_TARGETS)
}

/**
 * 표 셀 배경 팔레트의 색상. index.css 의 data-shade 규칙과 짝이다.
 * 회색은 색상이 없으므로 채도로만 가른다.
 */
const CELL_SHADE_TARGETS: { shade: string; hue: number }[] = [
  { shade: 'yellow', hue: 48 },
  { shade: 'green', hue: 152 },
  { shade: 'blue', hue: 200 },
  { shade: 'pink', hue: 327 },
]

/**
 * 붙여넣은 셀 배경을 팔레트 값으로 맞춘다.
 *
 * 셀 배경은 형광펜과 다르다. 형광펜으로 넘기면 글자 뒤에만 색이 깔려서
 * 원본처럼 칸 전체가 칠해지지 않는다.
 */
export function snapCellShade(value: string): string | null {
  const rgb = toRgb(value)
  if (!rgb) return null
  const { hue, saturation, lightness } = toHsl(rgb)
  if (lightness > 0.97) return null // 흰 바탕은 배경 없음
  if (saturation < 0.12) return lightness < 0.9 ? 'gray' : null
  return CELL_SHADE_TARGETS.reduce((best, target) =>
    hueGap(hue, target.hue) < hueGap(hue, best.hue) ? target : best,
  ).shade
}
