import { Fragment, useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Formula } from '@/components/question/Formula'
import { ImageZoomModal } from '@/components/question/ImageZoomModal'
import { YamaCard } from '@/components/question/YamaCard'
import type { CSSProperties } from 'react'
import { safeLineHeight } from '@/components/editor/extensions/lineHeight'
import { LecturePageCard } from '@/components/lecture/LecturePageCard'
import { PageMarkLayer } from '@/components/lecture/PageMarkLayer'
import { parsePageMarks, type PageMark } from '@/components/lecture/pageMarks'
import { pageCropOf } from '@/components/lecture/pageCrop'
import { TheoryCard } from '@/components/question/TheoryCard'
import { safeFontSize } from '@/components/editor/extensions/fontSize'
import { HIGHLIGHT_SET, TEXT_COLOR_SET } from '@/components/editor/palette'
import { indentStyle, safeIndent } from '@/components/editor/extensions/indent'
import { renderMarkedText, type RenderMark } from '@/components/marking/marks'
import { useSignedUrl, useSignedUrlState } from '@/lib/storage'
import {
  cellShadeOf,
  colWidthsOf,
  imageLayoutOf,
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
    case 'callout':
      return (
        <aside data-callout="" className="callout-block">
          <span data-callout-icon="" aria-hidden="true">💡</span>
          <div data-callout-content="">{children}</div>
        </aside>
      )
    case 'codeBlock':
      return (
        <pre>
          <code>{children}</code>
        </pre>
      )
    case 'table': {
      const columns = tableColumnsOf(node)
      const tableWidth =
        columns && columns.every((width): width is number => width !== null && width > 0)
          ? columns.reduce((sum, width) => sum + width, 0)
          : null

      return (
        <div className="overflow-x-auto">
          {/* 편집기에서 정한 열 너비의 합을 표 전체 폭에도 적용한다. 열만 복원하고
              표를 w-full 로 두면 저장 후 본문 폭 끝까지 다시 늘어난다. */}
          <table
            data-border={tableBorderOf(node.attrs?.border) ?? undefined}
            style={tableWidth ? { width: tableWidth } : undefined}
          >
            {colGroupOf(columns)}
            <tbody>{children}</tbody>
          </table>
        </div>
      )
    }
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
/** 문단에 걸린 들여쓰기와 줄간격. 편집기에서 정한 것을 읽는 화면에도 그대로 쓴다. */
function blockIndentStyle(node: RichNode): CSSProperties | undefined {
  const margin = indentStyle(safeIndent(node.attrs?.indent))
  const lineHeight = safeLineHeight(node.attrs?.lineHeight)
  if (!margin && !lineHeight) return undefined
  return {
    ...(margin ? { marginLeft: margin } : {}),
    ...(lineHeight ? { lineHeight } : {}),
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
  if (level === 3) return 'hierarchy-indent-3'
  return undefined
}

// \uae00\uba38\ub9ac\ud45c\ub85c \uc2dc\uc791\ud558\ub294 \uc904. \ud3b8\uc9d1\uae30 \ubaa9\ub85d(-, *, +)\ubfd0 \uc544\ub2c8\ub77c \ubcf8\ubb38\uc5d0 \uc9c1\uc811 \ucc0d\uc740
// \uac00\uc6b4\ub383\uc810/\ub3d9\uadf8\ub77c\ubbf8(\u2022, \u00b7, \u25cf, \u25aa, \u25e6, \u2023)\ub3c4 \ubaa9\ub85d \ud56d\ubaa9\uc73c\ub85c \ubcf8\ub2e4.
const BULLET_LINE = /^\s*[-*+\u2022\u00b7\u25cf\u25aa\u25e6\u2023]\s+/

function inferIndentLevels(nodes: RichNode[]): number[] {
  let previousLevel = 0
  return nodes.map((node) => {
    const text = nodeText(node)
    const isBullet = node.type === 'bulletList' || BULLET_LINE.test(text)
    let level: number
    if (/^\s*\d+\./.test(text)) level = 0
    else if (/^\s*\d+\)/.test(text)) level = 1
    else if (/^\s*\(\d+\)/.test(text)) level = 2
    else if (/^\s*[\u2460-\u2473]/.test(text)) level = 3
    // \uae00\uba38\ub9ac\ud45c \uc904\uc740 \uacc4\uce35 \uae30\ud638\uac00 \uc5c6\uc73c\ubbc0\ub85c \ubc14\ub85c \uc717\uc904\uc758 \ub4e4\uc5ec\uc4f0\uae30\ub97c \uadf8\ub300\ub85c \ubb3c\ub824\ubc1b\ub294\ub2e4.
    else if (isBullet) level = previousLevel
    else level = 0

    if (!isBullet) previousLevel = level
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
function tableColumnsOf(node: RichNode): (number | null)[] | null {
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

  return cols
}

function colGroupOf(cols: (number | null)[] | null) {
  if (!cols) return null
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
      const layout = imageLayoutOf(node.attrs?.layout)
      const crop = pageCropOf(node.attrs?.crop)
      const imageMarks = parsePageMarks(node.attrs?.strokes)
      return src ? (
        <div
          className="stored-image-view"
          data-image-layout={layout ?? 'full'}
        >
          <ViewerImage
            path={src}
            alt={alt}
            width={width}
            crop={crop}
            marks={imageMarks}
            onZoom={context.onZoom}
          />
        </div>
      ) : null
    }
    case 'video': {
      const src = typeof node.attrs?.src === 'string' ? node.attrs.src : null
      return src ? <ViewerVideo path={src} /> : null
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
    case 'lecturePageEmbed': {
      const attrs = (node.attrs ?? {}) as Record<string, unknown>
      return (
        <div
          className="lecture-page-embed"
          data-page-layout={attrs.layout === 'half' ? 'half' : 'full'}
        >
          <LecturePageCard
            src={typeof attrs.src === 'string' ? attrs.src : null}
            lectureId={typeof attrs.lectureId === 'string' ? attrs.lectureId : null}
            page={typeof attrs.page === 'number' ? attrs.page : null}
            title={typeof attrs.title === 'string' ? attrs.title : null}
            professor={typeof attrs.professor === 'string' ? attrs.professor : null}
            width={typeof attrs.width === 'number' ? attrs.width : null}
            crop={pageCropOf(attrs.crop)}
            marks={parsePageMarks(attrs.strokes)}
          />
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
  crop,
  marks,
  onZoom,
}: {
  path: string
  alt: string | null
  /** 작성자가 편집기에서 정한 폭(px). 없으면 예전처럼 높이로 가둔다. */
  width: number | null
  crop: ReturnType<typeof pageCropOf>
  marks: PageMark[]
  onZoom: (src: string) => void
}) {
  const external = /^https?:\/\//i.test(path)
  const { url: signedUrl, status, retry, onImageError } = useSignedUrlState(external ? null : path)
  const src = external ? path : signedUrl
  const [naturalSize, setNaturalSize] = useState<{ width: number; aspect: number } | null>(null)
  const [failedExternal, setFailedExternal] = useState(false)
  const cropAspectRatio =
    crop && naturalSize ? crop.width / (crop.height * naturalSize.aspect) : null
  const cropReady = cropAspectRatio !== null ? crop : null
  const displayWidth = width ?? (crop ? imageWidthOf(naturalSize?.width) : null)

  if ((!external && status === 'failed') || failedExternal) {
    return (
      <div
        role="alert"
        data-print-failed="image"
        className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-amber-300 text-sm text-amber-700 dark:border-amber-800 dark:text-amber-300"
      >
        본문 이미지를 불러오지 못했습니다.
        {!external && (
          <button type="button" onClick={retry} className="underline">
            다시 불러오기
          </button>
        )}
      </div>
    )
  }

  if (!src) {
    return (
      <div
        data-print-pending="image"
        className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400 dark:border-slate-700"
      >
        이미지를 불러오는 중입니다
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onZoom(src)}
      // 폭만 박아 두면 좁은 칸(내보내기 2단 등)에서 넘친다. 넘치면 종이보다
      // 넓어져 브라우저가 쪽 전체를 줄여 버린다.
      style={displayWidth ? { width: displayWidth, maxWidth: '100%' } : undefined}
      className={cn(
        'relative block w-fit max-w-full cursor-zoom-in',
        !naturalSize && 'min-h-24 min-w-40',
      )}
    >
      {!naturalSize && (
        <span className="absolute inset-0 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400 dark:border-slate-700">
          이미지를 불러오는 중입니다
        </span>
      )}
      <span
        style={
          cropAspectRatio !== null
            ? { aspectRatio: cropAspectRatio }
            : undefined
        }
        className="relative block overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
      >
        <span
          style={
            cropReady
              ? {
                  position: 'absolute',
                  left: `${-(cropReady.x / cropReady.width) * 100}%`,
                  top: `${-(cropReady.y / cropReady.height) * 100}%`,
                  width: `${100 / cropReady.width}%`,
                }
              : undefined
          }
          className="relative block"
        >
          <img
            src={src}
            alt={alt ?? '본문 이미지'}
            loading="lazy"
            // 서명은 받았는데 그림만 못 받는 일이 있다. 서명을 버리고 다시 받는다.
            onError={() => {
              setNaturalSize(null)
              if (external) setFailedExternal(true)
              else onImageError()
            }}
            onLoad={(event) => {
              const image = event.currentTarget
              if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return
              setNaturalSize({
                width: image.naturalWidth,
                aspect: image.naturalHeight / image.naturalWidth,
              })
            }}
            style={displayWidth ? { width: '100%' } : undefined}
            className={cn('block h-auto max-w-full', !naturalSize && 'invisible')}
          />
          <PageMarkLayer marks={marks} aspect={naturalSize?.aspect ?? 1} />
        </span>
      </span>
    </button>
  )
}

/**
 * 비공개 공지 영상 플레이어.
 *
 * 문서에는 만료되지 않는 Storage 경로만 저장하고, 열람하는 계정의 권한으로
 * 서명 URL을 새로 받는다. 컨테이너 폭을 넘기지 않아 휴대폰에서도 가로 스크롤 없이
 * 재생할 수 있다.
 */
function ViewerVideo({ path }: { path: string }) {
  const external = /^https?:\/\//i.test(path)
  const signedUrl = useSignedUrl(external ? null : path)
  const src = external ? path : signedUrl

  if (!src) {
    return (
      <div className="my-3 flex h-36 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        영상을 불러오는 중입니다
      </div>
    )
  }

  return (
    <video
      src={src}
      controls
      playsInline
      preload="metadata"
      className="my-3 max-h-[75vh] w-full rounded-lg bg-black"
    >
      이 브라우저에서는 영상을 재생할 수 없습니다.
    </video>
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
        if (!href) return acc
        return href.startsWith('/') ? (
          <Link to={href}>{acc}</Link>
        ) : (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {acc}
          </a>
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
