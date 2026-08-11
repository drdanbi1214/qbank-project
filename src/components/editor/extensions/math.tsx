/* eslint-disable react-refresh/only-export-components -- Tiptap 확장과 그 노드뷰는 한 파일에 두는 편이 읽기 쉽다. */
import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core'
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react'
import { Formula } from '@/components/question/Formula'

/**
 * 수식 노드. `$...$` 는 인라인, `$$...$$` 는 블록으로 변환된다.
 *
 * 원본 LaTeX 를 attrs.latex 에 그대로 보관하고 화면에는 KaTeX 결과만 그린다.
 * 노드가 선택되면 아래에 원본 입력창이 열려 그 자리에서 고칠 수 있다.
 * (atom 이라 내부에 커서를 둘 수 없어서 별도 입력창이 필요하다.)
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      setMathInline: (latex: string) => ReturnType
      setMathBlock: (latex: string) => ReturnType
    }
  }
}

function MathNodeView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const latex = typeof node.attrs.latex === 'string' ? node.attrs.latex : ''
  const display = node.type.name === 'mathBlock'

  return (
    <NodeViewWrapper
      as={display ? 'div' : 'span'}
      className={display ? 'my-2' : 'inline-block align-middle'}
    >
      <span
        className={
          selected
            ? 'rounded bg-brand-100 px-0.5 dark:bg-brand-900/50'
            : 'rounded px-0.5'
        }
      >
        {latex ? (
          <Formula latex={latex} display={display} />
        ) : (
          <span className="text-sm text-slate-400">수식을 입력하세요</span>
        )}
      </span>

      {selected && editor.isEditable && (
        <input
          value={latex}
          autoFocus
          onChange={(event) => updateAttributes({ latex: event.target.value })}
          placeholder="LaTeX"
          className="mt-1 block w-full rounded border border-brand-400 bg-white px-2 py-1 font-mono text-xs outline-none dark:bg-slate-900"
        />
      )}
    </NodeViewWrapper>
  )
}

const attributes = {
  latex: {
    default: '',
    parseHTML: (element: HTMLElement) => element.getAttribute('data-latex') ?? '',
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-latex': String(attrs.latex ?? '') }),
  },
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes: () => attributes,

  parseHTML: () => [{ tag: 'span[data-math-inline]' }],

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-math-inline': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },

  addCommands() {
    return {
      setMathInline:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: 'mathInline', attrs: { latex } }),
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        // 첫 번째 캡처가 $ 를 포함한 전체 구간이어야 한다. Tiptap 은 이 그룹의
        // 범위만 노드로 바꾸므로, 안쪽 수식만 잡으면 양옆 $ 가 본문에 남는다.
        // 줄바꿈이나 다른 $ 를 포함하지 않는 한 쌍만 수식으로 본다.
        find: /(?:^|[^$])(\$([^$\n]+)\$)$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[2] }),
      }),
    ]
  },
})

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes: () => attributes,

  parseHTML: () => [{ tag: 'div[data-math-block]' }],

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-math-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(MathNodeView)
  },

  addCommands() {
    return {
      setMathBlock:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({ type: 'mathBlock', attrs: { latex } }),
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /^(\$\$([^$]+)\$\$)$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[2] }),
      }),
    ]
  },
})
