/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'

/**
 * 각주.
 *
 * 본문에는 위첨자 번호만 남기고 내용은 attrs.text 에 담는다. 번호는 저장하지
 * 않고 문서 안에서의 순서로 매번 다시 센다 — 중간에 각주를 끼워 넣어도 번호가
 * 저절로 밀린다.
 *
 * 내용을 평문으로 두는 이유는 각주 안에 또 이미지나 표가 들어가면 읽는 쪽에서
 * 각주 목록이 본문만큼 길어지기 때문이다.
 *
 * richtext.ts 의 LEAF_TYPES 에도 같은 이름이 등록되어 있어야 인라인 코멘트
 * 위치가 어긋나지 않는다.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: () => ReturnType
    }
  }
}

function FootnoteView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const text = typeof node.attrs.text === 'string' ? node.attrs.text : ''

  // 앞쪽에 각주가 새로 생기면 이 각주의 번호도 바뀐다. 자기 노드가 안 바뀌면
  // 노드뷰는 다시 그려지지 않으므로 문서 변경을 직접 듣는다.
  const [, forceRender] = useState(0)
  useEffect(() => {
    const rerender = () => forceRender((value) => value + 1)
    editor.on('transaction', rerender)
    return () => {
      editor.off('transaction', rerender)
    }
  }, [editor])

  const number = footnoteNumber(editor.state.doc, getPos())

  return (
    <NodeViewWrapper as="span" className="relative inline-block align-baseline">
      <sup
        title={text || '각주 내용을 입력하세요'}
        className={
          selected
            ? 'cursor-pointer rounded bg-brand-500 px-1 text-[10px] font-bold text-white'
            : 'cursor-pointer rounded bg-brand-100 px-1 text-[10px] font-bold text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
        }
      >
        {number}
      </sup>

      {selected && editor.isEditable && (
        <span className="absolute left-0 top-full z-20 mt-1 block w-72 rounded-lg border border-brand-400 bg-white p-1 shadow-lg dark:bg-slate-900">
          <textarea
            value={text}
            autoFocus
            rows={3}
            onChange={(event) => updateAttributes({ text: event.target.value })}
            placeholder="각주 내용"
            className="block w-full resize-none bg-transparent px-1 py-0.5 text-xs outline-none"
          />
        </span>
      )}
    </NodeViewWrapper>
  )
}

/** 문서 처음부터 이 위치까지의 각주 개수. 곧 이 각주의 번호다. */
function footnoteNumber(doc: ProseMirrorNode, self: number | undefined): number {
  if (typeof self !== 'number') return 1
  let count = 0
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote' && pos <= self) count += 1
  })
  return Math.max(count, 1)
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-footnote') ?? '',
        renderHTML: (attributes) => ({ 'data-footnote': String(attributes.text ?? '') }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(FootnoteView)
  },

  addCommands() {
    return {
      insertFootnote:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { text: '' } }),
    }
  },
})
