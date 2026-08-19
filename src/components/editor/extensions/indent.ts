import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockIndent: {
      indentBlock: () => ReturnType
      outdentBlock: () => ReturnType
    }
  }
}

/** 한 단계 들여쓰기 폭(rem). 목록의 기본 들여쓰기와 눈에 맞춘다. */
export const INDENT_STEP_REM = 1.5
const MAX_INDENT = 8

/** 본문 jsonb 는 신뢰할 수 없는 입력이라 값을 범위 안으로 가둔다. */
export function safeIndent(value: unknown): number {
  const level = typeof value === 'number' ? Math.floor(value) : 0
  if (!Number.isFinite(level) || level <= 0) return 0
  return Math.min(level, MAX_INDENT)
}

export function indentStyle(level: number): string | undefined {
  return level > 0 ? `${level * INDENT_STEP_REM}rem` : undefined
}

/**
 * 문단·제목 들여쓰기.
 *
 * 목록 안에서는 목록의 계층 조작(sink/lift)으로 넘긴다. 목록을 margin 으로
 * 밀면 글머리 기호가 따라오지 않아 계층이 어긋나 보인다.
 */
export const BlockIndent = Extension.create({
  name: 'blockIndent',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => safeIndent(Number(element.getAttribute('data-indent'))),
            renderHTML: (attributes) => {
              const level = safeIndent(attributes.indent)
              if (level === 0) return {}
              return {
                'data-indent': String(level),
                style: `margin-left: ${indentStyle(level)}`,
              }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      indentBlock:
        () =>
        ({ editor, commands }) => {
          if (editor.isActive('listItem')) return commands.sinkListItem('listItem')
          const current = safeIndent(editor.getAttributes('paragraph').indent)
          const heading = safeIndent(editor.getAttributes('heading').indent)
          const level = editor.isActive('heading') ? heading : current
          return commands.updateAttributes(
            editor.isActive('heading') ? 'heading' : 'paragraph',
            { indent: Math.min(level + 1, MAX_INDENT) },
          )
        },
      outdentBlock:
        () =>
        ({ editor, commands }) => {
          if (editor.isActive('listItem')) return commands.liftListItem('listItem')
          const isHeading = editor.isActive('heading')
          const level = safeIndent(
            editor.getAttributes(isHeading ? 'heading' : 'paragraph').indent,
          )
          return commands.updateAttributes(isHeading ? 'heading' : 'paragraph', {
            indent: Math.max(level - 1, 0),
          })
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indentBlock(),
      'Shift-Tab': () => this.editor.commands.outdentBlock(),
    }
  },
})
