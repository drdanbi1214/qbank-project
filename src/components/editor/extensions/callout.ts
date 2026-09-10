import { Node, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      insertCallout: () => ReturnType
    }
  }
}

/**
 * 노션처럼 본문 흐름 안에 들어가는 안내 상자.
 * block+를 받아 한 줄뿐 아니라 목록·여러 문단도 상자 안에서 계속 편집할 수 있다.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: '[data-callout]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'aside',
      mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout-block' }),
      ['span', { 'data-callout-icon': '', contenteditable: 'false' }, '💡'],
      ['div', { 'data-callout-content': '' }, 0],
    ]
  },

  addCommands() {
    return {
      insertCallout:
        () =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            content: [{ type: 'paragraph' }],
          }),
    }
  },
})
