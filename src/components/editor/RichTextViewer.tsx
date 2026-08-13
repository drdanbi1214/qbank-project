import { Fragment, useState, type ReactNode } from 'react'
import { Formula } from '@/components/question/Formula'
import { ImageZoomModal } from '@/components/question/ImageZoomModal'
import { renderMarkedText, type RenderMark } from '@/components/marking/marks'
import { useSignedUrl } from '@/lib/storage'
import { isLeafNode, type RichDoc, type RichMark, type RichNode } from '@/types/richtext'
import { cn } from '@/utils/cn'

type Props = {
  doc: RichDoc
  className?: string
  /** `1.` → `1)` → `(1)` 표기를 읽어 문단 들여쓰기를 자동 적용한다. */
  hierarchicalIndent?: boolean
  /** 인라인 코멘트와 사용자 형광펜을 같은 통로로 그린다 */
  marks?: RenderMark[]
  /** 표시된 구간을 누르면 해당 코멘트로 이동 */
  onMarkClick?: (id: string) => void
  /** 현재 선택된 코멘트 (테두리 강조) */
  activeMarkId?: string | null
}

/**
 * Tiptap JSON 을 읽기 전용으로 그린다.
 *
 * 읽기 전용 Tiptap 인스턴스를 띄우지 않고 직접 그리는 이유:
 *  - 이미지가 비공개 버킷이라 표시 시점에 서명 URL 을 새로 받아야 한다
 *  - HTML 문자열을 만들어 넣지 않으므로 주입 위험이 없다
 *  - 인라인 코멘트 하이라이트를 위해 각 텍스트 조각의 ProseMirror 위치를
 *    data-pos 로 남겨야 한다
 */
export function RichTextViewer({
  doc,
  className,
  hierarchicalIndent = false,
  marks = [],
  onMarkClick,
  activeMarkId,
}: Props) {
  const [zoomed, setZoomed] = useState<string | null>(null)
  const cursor = { pos: 0 }

  const context: RenderContext = {
    marks,
    onMarkClick,
    activeMarkId: activeMarkId ?? null,
    onZoom: setZoomed,
  }
  const indentLevels = hierarchicalIndent ? inferIndentLevels(doc.content) : []

  return (
    <div className={cn('rich-text', hierarchicalIndent && 'hierarchical-rich-text', className)}>
      {doc.content.map((node, index) => (
        <Fragment key={index}>{renderNode(node, cursor, context, indentLevels[index])}</Fragment>
      ))}
      {zoomed && <ImageZoomModal src={zoomed} caption={null} onClose={() => setZoomed(null)} />}
    </div>
  )
}

type RenderContext = {
  marks: RenderMark[]
  onMarkClick?: (id: string) => void
  activeMarkId: string | null
  onZoom: (src: string) => void
}

type Cursor = { pos: number }

function renderChildren(node: RichNode, cursor: Cursor, context: RenderContext): ReactNode[] {
  return (node.content ?? []).map((child, index) => (
    <Fragment key={index}>{renderNode(child, cursor, context)}</Fragment>
  ))
}

function renderNode(node: RichNode, cursor: Cursor, context: RenderContext, indentLevel?: number): ReactNode {
  if (node.type === 'text') {
    return renderText(node, cursor, context)
  }

  if (isLeafNode(node.type)) {
    const start = cursor.pos
    cursor.pos += 1
    return renderLeaf(node, start, context)
  }

  // 여는 태그 1칸
  cursor.pos += 1
  const children = renderChildren(node, cursor, context)
  // 닫는 태그 1칸
  cursor.pos += 1

  switch (node.type) {
    case 'paragraph':
      return <p className={hierarchyClass(node, indentLevel)}>{children.length > 0 ? children : <br />}</p>
    case 'aiTitle':
      return <p className="mb-1 mt-4 font-bold text-slate-900 dark:text-slate-100">{children}</p>
    case 'aiEvidence':
      return <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{children}</p>
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 3
      if (level <= 2) return <h2 className={hierarchyClass(node, indentLevel)}>{children}</h2>
      if (level === 3) return <h3 className={hierarchyClass(node, indentLevel)}>{children}</h3>
      return <h4 className={hierarchyClass(node, indentLevel)}>{children}</h4>
    }
    case 'bulletList':
      return <ul className={cn(indentClass(indentLevel), indentLevel !== undefined && 'inherited-bullet-list')}>{children}</ul>
    case 'orderedList':
      return <ol className={indentClass(indentLevel)}>{children}</ol>
    case 'listItem':
      return <li>{children}</li>
    case 'blockquote':
      return <blockquote>{children}</blockquote>
    case 'codeBlock':
      return (
        <pre>
          <code>{children}</code>
        </pre>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table>
            <tbody>{children}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr>{children}</tr>
    case 'tableHeader':
      return <th colSpan={spanOf(node, 'colspan')} rowSpan={spanOf(node, 'rowspan')}>{children}</th>
    case 'tableCell':
      return <td colSpan={spanOf(node, 'colspan')} rowSpan={spanOf(node, 'rowspan')}>{children}</td>
    default:
      // 모르는 블록은 내용만 살려서 보여준다.
      return <div>{children}</div>
  }
}

function hierarchyClass(node: RichNode, level?: number): string | undefined {
  return cn(
    indentClass(level),
    level !== undefined && /^\s*\d+\./.test(nodeText(node)) && 'hierarchy-section-start',
  ) || undefined
}

function indentClass(level?: number): string | undefined {
  if (level === 1) return 'hierarchy-indent-1'
  if (level === 2) return 'hierarchy-indent-2'
  return undefined
}

function inferIndentLevels(nodes: RichNode[]): number[] {
  let previousLevel = 0
  return nodes.map((node) => {
    const text = nodeText(node)
    let level: number
    if (/^\s*\d+\./.test(text)) level = 0
    else if (/^\s*\d+\)/.test(text)) level = 1
    else if (/^\s*\(\d+\)/.test(text)) level = 2
    else if (node.type === 'bulletList' || /^\s*[-*+]\s+/.test(text)) level = previousLevel
    else level = 0

    if (node.type !== 'bulletList' && !/^\s*[-*+]\s+/.test(text)) previousLevel = level
    return level
  })
}

function nodeText(node: RichNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(nodeText).join('')
}

function spanOf(node: RichNode, key: 'colspan' | 'rowspan'): number | undefined {
  const value = node.attrs?.[key]
  return typeof value === 'number' && value > 1 ? value : undefined
}

function renderLeaf(node: RichNode, start: number, context: RenderContext): ReactNode {
  switch (node.type) {
    case 'hardBreak':
      return <br />
    case 'horizontalRule':
      return <hr />
    case 'image': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : null
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : null
      return src ? <ViewerImage path={src} alt={alt} onZoom={context.onZoom} /> : null
    }
    case 'mathInline':
      return <Formula latex={latexOf(node)} display={false} />
    case 'mathBlock':
      return <Formula latex={latexOf(node)} />
    default:
      return <span data-pos={start} />
  }
}

function latexOf(node: RichNode): string {
  return typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
}

function ViewerImage({
  path,
  alt,
  onZoom,
}: {
  path: string
  alt: string | null
  onZoom: (src: string) => void
}) {
  const external = /^https?:\/\//i.test(path)
  const signedUrl = useSignedUrl(external ? null : path)

  if (external) {
    return (
      <button type="button" onClick={() => onZoom(path)} className="block cursor-zoom-in">
        <img src={path} alt={alt ?? '본문 이미지'} loading="lazy" className="max-h-96 rounded-lg border border-slate-200 dark:border-slate-700" />
      </button>
    )
  }

  if (!signedUrl) {
    return <div className="h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
  }

  return (
    <button type="button" onClick={() => onZoom(signedUrl)} className="block cursor-zoom-in">
      <img
        src={signedUrl}
        alt={alt ?? '본문 이미지'}
        loading="lazy"
        className="max-h-96 rounded-lg border border-slate-200 dark:border-slate-700"
      />
    </button>
  )
}

// -----------------------------------------------------------------------------
// 텍스트 + 인라인 코멘트 하이라이트
// -----------------------------------------------------------------------------

function renderText(node: RichNode, cursor: Cursor, context: RenderContext): ReactNode {
  const text = node.text ?? ''
  const start = cursor.pos
  cursor.pos = start + text.length

  const body = renderMarkedText(text, start, context.marks, {
    activeMarkId: context.activeMarkId,
    onMarkClick: context.onMarkClick,
  })

  return applyMarks(<>{body}</>, node.marks ?? [])
}

function applyMarks(children: ReactNode, marks: RichMark[]): ReactNode {
  return marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{acc}</strong>
      case 'italic':
        return <em>{acc}</em>
      case 'underline':
        return <u>{acc}</u>
      case 'strike':
        return <s>{acc}</s>
      case 'code':
        return <code>{acc}</code>
      case 'highlight':
        return <mark>{acc}</mark>
      case 'link': {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : null
        return href ? (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {acc}
          </a>
        ) : (
          acc
        )
      }
      default:
        return acc
    }
  }, children)
}
