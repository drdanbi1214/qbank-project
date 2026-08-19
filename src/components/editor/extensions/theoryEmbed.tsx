/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { TheoryCard } from '@/components/question/TheoryCard'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    theoryEmbed: {
      insertTheory: (documentId: string) => ReturnType
    }
  }
}

/**
 * 테마 본문에 끼워 넣는 이론 문서.
 *
 * 야마와 같은 원자(atom) 노드다. 본문에는 documentId 만 담는다 — 내용을 복사해
 * 두면 원본 이론이 고쳐졌을 때 테마 쪽만 옛 내용으로 남는다.
 *
 * richtext.ts 의 LEAF_TYPES 에도 같은 이름이 등록되어 있어야 인라인 코멘트
 * 위치가 어긋나지 않는다.
 */
function TheoryEmbedView({ node, selected, editor, deleteNode }: NodeViewProps) {
  const documentId = typeof node.attrs.documentId === 'string' ? node.attrs.documentId : null

  return (
    <NodeViewWrapper
      as="div"
      className="my-3"
      contentEditable={false}
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
      onKeyUp={(event: KeyboardEvent) => event.stopPropagation()}
      onPaste={(event: ClipboardEvent) => event.stopPropagation()}
      onDrop={(event: DragEvent) => event.stopPropagation()}
    >
      <TheoryCard
        documentId={documentId}
        selected={selected}
        onRemove={editor.isEditable ? deleteNode : undefined}
      />
    </NodeViewWrapper>
  )
}

export const TheoryEmbed = Node.create({
  name: 'theoryEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      documentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-theory-id'),
        renderHTML: (attributes) =>
          attributes.documentId ? { 'data-theory-id': attributes.documentId } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-theory-embed]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-theory-embed': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TheoryEmbedView)
  },

  addCommands() {
    return {
      insertTheory:
        (documentId: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { documentId } }),
    }
  },
})
