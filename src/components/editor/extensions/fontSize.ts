import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType
      unsetFontSize: () => ReturnType
    }
  }
}

/** 도구 모음에서 고를 수 있는 글씨 크기. 값은 그대로 CSS font-size 로 들어간다. */
export const FONT_SIZES = [
  { label: '아주 작게', value: '0.8em' },
  { label: '작게', value: '0.9em' },
  { label: '보통', value: '' },
  { label: '크게', value: '1.25em' },
  { label: '아주 크게', value: '1.5em' },
] as const

/** 신뢰할 수 없는 값이 style 로 들어가지 않도록 허용 목록으로 막는다. */
const ALLOWED = new Set<string>(
  FONT_SIZES.map((item) => item.value).filter((value) => value !== ''),
)

export function safeFontSize(value: unknown): string | null {
  return typeof value === 'string' && ALLOWED.has(value) ? value : null
}

/**
 * 글씨 크기.
 *
 * TextStyle 마크에 속성을 하나 더 얹는 방식이다. 색깔(Color)이 이미 같은 자리를
 * 쓰고 있어 확장 하나로 끝난다.
 *
 * em 을 쓰는 이유: 마이페이지의 글자 크기 설정이 루트 폰트 크기를 바꾸는데,
 * px 로 박아두면 그 설정을 무시하고 혼자만 안 커진다.
 */
export const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => safeFontSize(element.style.fontSize),
            renderHTML: (attributes) => {
              const size = safeFontSize(attributes.fontSize)
              return size ? { style: `font-size: ${size}` } : {}
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})
