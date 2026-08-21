import { Fragment, useId, useState, type ReactNode } from 'react'
import { Formula } from '@/components/question/Formula'
import { ImageZoomModal } from '@/components/question/ImageZoomModal'
import { YamaCard } from '@/components/question/YamaCard'
import { TheoryCard } from '@/components/question/TheoryCard'
import { safeFontSize } from '@/components/editor/extensions/fontSize'
import { HIGHLIGHT_SET, TEXT_COLOR_SET } from '@/components/editor/palette'
import { indentStyle, safeIndent } from '@/components/editor/extensions/indent'
import { renderMarkedText, type RenderMark } from '@/components/marking/marks'
import { useSignedUrl } from '@/lib/storage'
import {
  cellShadeOf,
  colWidthsOf,
  imageWidthOf,
  isLeafNode,
  tableBorderOf,
  type RichDoc,
  type RichMark,
  type RichNode,
} from '@/types/richtext'
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
  // 한 화면에 뷰어가 여러 개 뜨므로 각주 앵커 id 가 겹치지 않게 접두사를 둔다.
  const anchorPrefix = useId()
  const cursor = { pos: 0 }

  const context: RenderContext = {
    marks,
    onMarkClick,
    activeMarkId: activeMarkId ?? null,
    onZoom: setZoomed,
    footnotes: [],
    anchorPrefix,
  }
  const indentLevels = hierarchicalIndent ? inferIndentLevels(doc.content) : []

  // 본문을 먼저 만들어야 context.footnotes 가 채워진다. renderNode 는 컴포넌트가
  // 아니라 그냥 함수라 이 자리에서 바로 실행된다.
  const body = doc.content.map((node, index) => (
    <Fragment key={index}>{renderNode(node, cursor, context, indentLevels[index])}</Fragment>
  ))

  return (
    <div className={cn('rich-text', hierarchicalIndent && 'hierarchical-rich-text', className)}>
      {body}
      {context.footnotes.length > 0 && (
        <div className="footnote-list">
          {context.footnotes.map((text, index) => (
            <div key={index} id={`${anchorPrefix}-note-${index + 1}`} className="flex gap-1.5">
              <a href={`#${anchorPrefix}-ref-${index + 1}`} className="footnote-back shrink-0">
                {index + 1}.
              </a>
              <span>{text}</span>
            </div>
          ))}
        </div>
      )}
      {zoomed && <ImageZoomModal src={zoomed} caption={null} onClose={() => setZoomed(null)} />}
    </div>
  )
}

type RenderContext = {
  marks: RenderMark[]
  onMarkClick?: (id: string) => void
  activeMarkId: string | null
  onZoom: (src: string) => void
  /** 본문을 훑는 동안 나온 순서대로 쌓인다. 아래쪽 각주 목록이 이걸 쓴다. */
  footnotes: string[]
  anchorPrefix: string
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
      return (
        <p className={hierarchyClass(node, indentLevel)} style={blockIndentStyle(node)}>
          {children.length > 0 ? children : <br />}
        </p>
      )
    case 'aiTitle':
      return <p className="mb-1 mt-4 font-bold text-slate-900 dark:text-slate-100">{children}</p>
    case 'aiEvidence':
      return <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{children}</p>
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 3
      const cls = hierarchyClass(node, indentLevel)
      const style = blockIndentStyle(node)
      if (level <= 2) return <h2 className={cls} style={style}>{children}</h2>
      if (level === 3) return <h3 className={cls} style={style}>{children}</h3>
      return <h4 className={cls} style={style}>{children}</h4>
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
          {/* 편집기에서 정한 열 너비·테두리를 읽기 화면에서도 그대로 살린다. */}
          <table data-border={tableBorderOf(node.attrs?.border) ?? undefined}>
            {colGroupOf(node)}
            <tbody>{children}</tbody>
          </table>
        </div>
      )
    case 'tableRow':
      return <tr>{children}</tr>
    case 'tableHeader':
      return (
        <th
          colSpan={spanOf(node, 'colspan')}
          rowSpan={spanOf(node, 'rowspan')}
          data-shade={cellShadeOf(node.attrs?.shade) ?? undefined}
        >
          {children}
        </th>
      )
    case 'tableCell':
      return (
        <td
          colSpan={spanOf(node, 'colspan')}
          rowSpan={spanOf(node, 'rowspan')}
          data-shade={cellShadeOf(node.attrs?.shade) ?? undefined}
        >
          {children}
        </td>
      )
    default:
      // 모르는 블록은 내용만 살려서 보여준다.
      return <div>{children}</div>
  }
}

/** 작성자가 도구 모음으로 준 들여쓰기. 본문에서 추론하는 계층과는 별개다. */
function blockIndentStyle(node: RichNode): { marginLeft: string } | undefined {
  const value = indentStyle(safeIndent(node.attrs?.indent))
  return value ? { marginLeft: value } : undefined
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
  if (level === 3) return 'hierarchy-indent-3'
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
    else if (/^\s*[\u2460-\u2473]/.test(text)) level = 3
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

/**
 * 편집기에서 드래그로 정한 열 너비를 <colgroup> 으로 옮긴다.
 *
 * Tiptap 은 너비를 첫 행 셀들의 colwidth 에 담아 둔다. 병합된 칸은 colspan
 * 만큼 열을 차지하므로 그만큼 col 을 만들어야 열이 밀리지 않는다.
 */
function colGroupOf(node: RichNode) {
  const firstRow = node.content?.find((child) => child.type === 'tableRow')
  if (!firstRow?.content) return null

  const cols: (number | null)[] = []
  for (const cell of firstRow.content) {
    const widths = colWidthsOf(cell.attrs?.colwidth)
    // spanOf 는 1 이면 undefined 를 준다(속성 생략용). 열 수를 셀 때는 1 로 본다.
    const span = spanOf(cell, 'colspan') ?? 1
    for (let index = 0; index < span; index += 1) cols.push(widths?.[index] ?? null)
  }
  if (cols.every((width) => width === null)) return null

  return (
    <colgroup>
      {cols.map((width, index) => (
        <col key={index} style={width ? { width } : undefined} />
      ))}
    </colgroup>
  )
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
      const width = imageWidthOf(node.attrs?.width)
      return src ? <ViewerImage path={src} alt={alt} width={width} onZoom={context.onZoom} /> : null
    }
    case 'footnote': {
      const text = typeof node.attrs?.text === 'string' ? node.attrs.text : ''
      context.footnotes.push(text)
      const number = context.footnotes.length
      return (
        <sup id={`${context.anchorPrefix}-ref-${number}`}>
          <a href={`#${context.anchorPrefix}-note-${number}`} title={text} className="footnote-ref">
            {number}
          </a>
        </sup>
      )
    }
    case 'mathInline':
      return <Formula latex={latexOf(node)} display={false} />
    case 'mathBlock':
      return <Formula latex={latexOf(node)} />
    case 'theoryEmbed': {
      const documentId =
        typeof node.attrs?.documentId === 'string' ? node.attrs.documentId : null
      return (
        <div className="my-3">
          <TheoryCard documentId={documentId} />
        </div>
      )
    }
    case 'yamaEmbed': {
      const questionId =
        typeof node.attrs?.questionId === 'string' ? node.attrs.questionId : null
      return (
        <div className="my-3">
          <YamaCard questionId={questionId} />
        </div>
      )
    }
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
  width,
  onZoom,
}: {
  path: string
  alt: string | null
  /** 작성자가 편집기에서 정한 폭(px). 없으면 예전처럼 높이로 가둔다. */
  width: number | null
  onZoom: (src: string) => void
}) {
  const external = /^https?:\/\//i.test(path)
  const signedUrl = useSignedUrl(external ? null : path)
  const src = external ? path : signedUrl

  if (!src) {
    return <div className="h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
  }

  return (
    <button type="button" onClick={() => onZoom(src)} className="block cursor-zoom-in">
      <img
        src={src}
        alt={alt ?? '본문 이미지'}
        loading="lazy"
        style={width ? { width } : undefined}
        // 폭 미지정이면 원본 크기로 둔다. 넘치면 max-w-full 이 줄인다.
        className="h-auto max-w-full rounded-lg border border-slate-200 dark:border-slate-700"
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
      case 'highlight': {
        // 모르는 색이면 강조 자체를 그리지 않는다. 색 없는 <mark> 로 두면 CSS
        // 기본값(노랑)이 먹어서 원본에 없던 형광펜이 생긴다.
        const color = safeHighlightColor(mark.attrs?.color)
        return color ? <mark style={{ backgroundColor: color }}>{acc}</mark> : acc
      }
      case 'textStyle': {
        const color = safeTextColor(mark.attrs?.color)
        const fontSize = safeFontSize(mark.attrs?.fontSize)
        if (!color && !fontSize) return acc
        return <span style={{ ...(color ? { color } : {}), ...(fontSize ? { fontSize } : {}) }}>{acc}</span>
      }
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

/**
 * 저장된 문서 JSON 이 임의 CSS 를 주입하지 못하도록 팔레트 색만 허용한다.
 * 붙여넣기 시점에 팔레트로 맞춰지므로(palette.ts) 여기서 걸리는 건 사실상
 * 그 경로를 타지 않고 들어온 옛 문서뿐이다.
 */
function safeTextColor(value: unknown): string | undefined {
  return typeof value === 'string' && TEXT_COLOR_SET.has(value) ? value : undefined
}

function safeHighlightColor(value: unknown): string | undefined {
  return typeof value === 'string' && HIGHLIGHT_SET.has(value) ? value : undefined
}
