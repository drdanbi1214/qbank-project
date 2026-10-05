export type YamaLayout = 'auto' | 'two-columns' | 'stacked'

/** 예전 글과 잘못된 속성 값은 기존 자동 배치로 읽는다. */
export function yamaLayoutOf(value: unknown): YamaLayout {
  return value === 'two-columns' || value === 'stacked' ? value : 'auto'
}

export function yamaColumnCount(layout: YamaLayout, cardCount: number): number {
  return layout === 'stacked' ? 1 : Math.min(cardCount, layout === 'two-columns' ? 2 : 3)
}
