/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { YamaCard } from '@/components/question/YamaCard'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    yamaEmbed: {
      insertYama: (questionId: string) => ReturnType
    }
  }
}

/**
 * 테마 본문에 끼워 넣는 야마.
 *
 * 문제 하나를 통째로 가리키는 원자(atom) 노드다. 자식을 가지지 않으므로
 * ProseMirror 위치 계산에서 크기 1로 센다 — richtext.ts 의 LEAF_TYPES 에도
 * 같은 이름이 등록되어 있어야 인라인 코멘트 위치가 어긋나지 않는다.
 *
 * 본문에는 questionId 만 담는다. 문제 내용을 복사해 두면 원본이 고쳐졌을 때
 * 테마 쪽만 옛 내용으로 남는다.
 */
function YamaEmbedView({ node, selected, editor, deleteNode }: NodeViewProps) {
  const questionId = typeof node.attrs.questionId === 'string' ? node.attrs.questionId : null

  return (
    <NodeViewWrapper as="div" className="my-3" data-drag-handle>
      <YamaCard
        questionId={questionId}
        selected={selected}
        onRemove={editor.isEditable ? deleteNode : undefined}
      />
    </NodeViewWrapper>
  )
}

export const YamaEmbed = Node.create({
  name: 'yamaEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      questionId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-question-id'),
        renderHTML: (attributes) =>
          attributes.questionId ? { 'data-question-id': attributes.questionId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-yama-embed]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-yama-embed': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(YamaEmbedView)
  },

  addCommands() {
    return {
      insertYama:
        (questionId: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { questionId } }),
    }
  },
})
