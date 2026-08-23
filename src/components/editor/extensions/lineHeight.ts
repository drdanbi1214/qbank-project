import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    // Tiptap 이 lineHeight 라는 이름을 이미 쓰고 있어 부딪히지 않게 따로 둔다.
    blockLineHeight: {
      setBlockLineHeight: (value: string) => ReturnType
    }
  }
}

/** 도구 모음에서 고를 수 있는 줄간격. 값은 그대로 CSS line-height 로 들어간다. */
export const LINE_HEIGHTS = [
  { label: '좁게', value: '1.3' },
  { label: '보통', value: '' },
  { label: '넓게', value: '1.9' },
] as const

/** 신뢰할 수 없는 값이 style 로 들어가지 않도록 허용 목록으로 막는다. */
const ALLOWED = new Set<string>(
  LINE_HEIGHTS.map((item) => item.value).filter((value) => value !== ''),
)

export function safeLineHeight(value: unknown): string | null {
  return typeof value === 'string' && ALLOWED.has(value) ? value : null
}

/**
 * 줄간격.
 *
 * 글자 크기(fontSize)와 달리 문단 단위라 TextStyle 마크가 아니라 블록 노드의
 * 속성으로 둔다. 한 문단 안에서 줄간격만 다른 줄을 만들 수는 없기 때문이다.
 *
 * 값을 비우면 속성 자체를 지워 그 자리의 기본 서식을 그대로 따르게 한다.
 * 풀이·테마처럼 읽는 화면마다 기본 줄간격이 다른데, 여기에 숫자를 박아 두면
 * 그 차이를 덮어써 버린다.
 */
export const LineHeight = Extension.create({
  name: 'blockLineHeight',

  addOptions() {
    return { types: ['paragraph', 'heading', 'listItem'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types as string[],
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => safeLineHeight(element.style.lineHeight),
            renderHTML: (attributes: Record<string, unknown>) => {
              const value = safeLineHeight(attributes.lineHeight)
              return value ? { style: `line-height:${value}` } : {}
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockLineHeight:
        (value: string) =>
        ({ commands }) => {
          const next = value === '' ? null : safeLineHeight(value)
          // 고른 범위에 걸친 문단마다 따로 걸어야 한 번에 바뀐다.
          return (this.options.types as string[])
            .map((type) => commands.updateAttributes(type, { lineHeight: next }))
            .some(Boolean)
        },
    }
  },
})
