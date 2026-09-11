import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { PageMarkLayer } from '@/components/lecture/PageMarkLayer'
import type { PageMark, StrokeTool } from '@/components/lecture/pageMarks'
import { Spinner } from '@/components/ui/Spinner'
import { renderLecturePageToBlob } from '@/components/lecture/renderLecturePage'
import { useLecturePdfAnnotations } from '@/components/lecture/useLecturePdfAnnotations'
import {
  countLectureSearchMatches,
  splitLectureSearchText,
} from '@/lib/lectureSearch'
import { writeLecturePageClipboard } from '@/lib/lectureClipboard'
import { getSignedUrl } from '@/lib/storage'

// 워커는 번들러가 별도 파일로 뽑아 준다. CDN 을 가리키면 버전이 어긋나는 순간
// 조용히 렌더가 멈추므로 설치된 패키지에서 직접 가져온다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// 한국어 CID 글꼴, PDF 기본 글꼴, ICC/JPEG 디코더는 worker 번들에 들어 있지
// 않다. 이 경로를 주지 않으면 원본 PDF가 멀쩡해도 일부 글자가 조용히 빠진다.
// vite.config.ts가 설치된 pdfjs-dist와 같은 버전의 파일을 이 위치에 내보낸다.
const PDFJS_ASSET_ROOT = `${import.meta.env.BASE_URL}pdfjs`

type Props = {
  storagePath: string
  title: string
  /** 읽기 화면에서 쪽 복사를 허용할 때 함께 담을 원본 정보. */
  lectureId?: string
  /** 대체본이면 원본 필기와 분리해서 저장할 대체본 id. */
  annotationVariantId?: string | null
  /** 대체본처럼 원본 쪽 번호와 다를 수 있는 PDF에서는 풀이용 쪽 복사를 숨긴다. */
  allowPageCopy?: boolean
  professor?: string | null
  initialPage?: number | null
  initialQuery?: string
  /** 독립 스크롤 분할 화면에서는 데스크톱 sticky 기준을 패널 맨 위로 둔다. */
  paneMode?: boolean
  /** 바깥 문서가 아니라 부모 패널 자체가 스크롤되는 화면이다. */
  containedScroll?: boolean
  /**
   * 글에 넣을 쪽을 고르는 모드. 쪽마다 체크칸이 생기고, 고른 쪽은 바깥에서
   * 알 수 있게 알려 준다. 읽기만 하는 화면에서는 끈다.
   */
  selectable?: boolean
  selectedPages?: number[]
  onTogglePage?: (pageNumber: number) => void
  /** PDF 가 열리면 알려 준다. 고른 쪽을 굽는 데 이 문서를 그대로 쓴다. */
  onDocumentReady?: (document: PDFDocumentProxy | null) => void
}

type SearchHit = { pageNumber: number; occurrenceIndex: number }
type AnnotationTool = StrokeTool | 'erase' | 'lasso' | null
type ExportState =
  | { status: 'idle' }
  | { status: 'working'; completed: number; total: number }
  | { status: 'error'; message: string }

const TOUCH_DRAWING_STORAGE_KEY = 'lecture-pdf-touch-drawing'
const ANNOTATION_SETTINGS_STORAGE_KEY = 'lecture-pdf-annotation-settings'
const PEN_COLORS = [
  { value: '#2563eb', label: '파랑' },
  { value: '#e11d48', label: '빨강' },
  { value: '#111827', label: '검정' },
  { value: '#16a34a', label: '초록' },
  { value: '#9333ea', label: '보라' },
  { value: '#ea580c', label: '주황' },
] as const
const HIGHLIGHT_COLORS = [
  { value: '#facc15', label: '노랑' },
  { value: '#22c55e', label: '연두' },
  { value: '#38bdf8', label: '하늘' },
  { value: '#f472b6', label: '분홍' },
  { value: '#fb923c', label: '주황' },
  { value: '#a78bfa', label: '보라' },
] as const
const PEN_WIDTHS = [0.0025, 0.004, 0.007] as const
const HIGHLIGHT_WIDTHS = [0.018, 0.03, 0.05] as const
const ERASER_RADII = [8, 14, 24] as const
/** 화면 폭 1,000px 기준 약 1.2px부터 채점용 28px까지의 색연필 굵기. */
const PENCIL_WIDTHS = [
  0.0012,
  0.002,
  0.003,
  0.0045,
  0.0065,
  0.009,
  0.012,
  0.016,
  0.021,
  0.028,
] as const

type AnnotationSettings = {
  penColor: string
  highlightColor: string
  pencilColor: string
  size: number
  pencilSize: number
  eraserSize: number
}

function isAnnotationColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

function initialAnnotationSettings(): AnnotationSettings {
  const fallback = {
    penColor: '#2563eb',
    highlightColor: '#facc15',
    pencilColor: '#e11d48',
    size: 1,
    pencilSize: 4,
    eraserSize: 1,
  }
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ANNOTATION_SETTINGS_STORAGE_KEY) ?? '') as Partial<AnnotationSettings>
    return {
      penColor: isAnnotationColor(parsed.penColor) ? parsed.penColor : fallback.penColor,
      highlightColor:
        isAnnotationColor(parsed.highlightColor) ? parsed.highlightColor : fallback.highlightColor,
      pencilColor:
        isAnnotationColor(parsed.pencilColor) ? parsed.pencilColor : fallback.pencilColor,
      size: Number.isInteger(parsed.size) && parsed.size! >= 0 && parsed.size! <= 2
        ? parsed.size!
        : fallback.size,
      pencilSize:
        Number.isInteger(parsed.pencilSize) && parsed.pencilSize! >= 0 && parsed.pencilSize! < PENCIL_WIDTHS.length
          ? parsed.pencilSize!
          : fallback.pencilSize,
      eraserSize:
        Number.isInteger(parsed.eraserSize) && parsed.eraserSize! >= 0 && parsed.eraserSize! < ERASER_RADII.length
          ? parsed.eraserSize!
          : fallback.eraserSize,
    }
  } catch {
    return fallback
  }
}

function initialTouchDrawing(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(TOUCH_DRAWING_STORAGE_KEY) === 'true'
}


function markTextLayer(container: HTMLDivElement, query: string, activeOccurrence: number | null) {
  let activeMark: HTMLElement | null = null
  const entries: { span: HTMLSpanElement; source: string; start: number; end: number }[] = []
  let combined = ''

  for (const span of container.querySelectorAll<HTMLSpanElement>('span')) {
    // markedContent를 감싼 PDF.js 부모 span만 건너뛴다. 우리가 앞선 검색에서
    // 넣은 mark는 원문으로 되돌린 뒤 새 검색어에 맞춰 다시 만든다.
    if ([...span.children].some((child) => child.tagName === 'SPAN')) continue
    const source = span.dataset.sourceText ?? span.textContent ?? ''
    span.dataset.sourceText = source
    span.replaceChildren(source)

    // PDF.js는 `ABC`를 A/B/C 여러 span으로 쪼갤 수 있다. 쪽 전체 문자열에서
    // 일치 위치를 먼저 구한 뒤 각 span으로 되돌려야 갈라진 글자도 모두 칠해진다.
    if (entries.length > 0) combined += ' '
    const start = combined.length
    combined += source
    entries.push({ span, source, start, end: combined.length })
  }

  const combinedParts = splitLectureSearchText(combined, query, true)
  const ranges: { start: number; end: number; occurrence: number }[] = []
  let combinedCursor = 0
  for (const part of combinedParts) {
    const start = combinedCursor
    combinedCursor += part.text.length
    if (part.hit && part.occurrence !== null) {
      ranges.push({ start, end: combinedCursor, occurrence: part.occurrence })
    }
  }

  for (const entry of entries) {
    const hits = ranges.filter((range) => range.end > entry.start && range.start < entry.end)
    if (hits.length === 0) continue

    const fragment = window.document.createDocumentFragment()
    let cursor = 0
    for (const hit of hits) {
      const start = Math.max(hit.start, entry.start) - entry.start
      const end = Math.min(hit.end, entry.end) - entry.start
      if (start > cursor) fragment.append(entry.source.slice(cursor, start))
      const mark = window.document.createElement('mark')
      mark.className = `lecture-pdf-search-hit${
        hit.occurrence === activeOccurrence ? ' lecture-pdf-search-hit-active' : ''
      }`
      if (hit.occurrence === activeOccurrence && !activeMark) activeMark = mark
      mark.textContent = entry.source.slice(start, end)
      fragment.append(mark)
      cursor = end
    }
    if (cursor < entry.source.length) fragment.append(entry.source.slice(cursor))
    entry.span.replaceChildren(fragment)
  }
  return activeMark
}

/** 한 쪽. 화면 가까이 왔을 때만 캔버스에 그린다. */
function PdfPage({
  document,
  pageNumber,
  width,
  searchQuery,
  activeSearchPage,
  activeSearchOccurrence,
  selectable = false,
  checked = false,
  onToggle,
  onCopy,
  marks = [],
  annotationTool = null,
  annotationColor,
  annotationWidth,
  eraserRadius,
  allowTouchDrawing = false,
  onMarksChange,
  onAnnotationInteract,
  onViewportPage,
  defaultRatio,
}: {
  document: PDFDocumentProxy
  pageNumber: number
  width: number
  /** 아직 안 그린 쪽이 자리를 잡을 때 쓰는 세로/가로 비율 */
  defaultRatio: number
  searchQuery: string
  activeSearchPage: boolean
  activeSearchOccurrence: number | null
  selectable?: boolean
  checked?: boolean
  onToggle?: () => void
  onCopy?: (pageNumber: number) => Promise<void>
  marks?: PageMark[]
  annotationTool?: AnnotationTool
  annotationColor?: string
  annotationWidth?: number
  eraserRadius?: number
  allowTouchDrawing?: boolean
  onMarksChange?: (marks: PageMark[]) => void
  onAnnotationInteract?: () => void
  onViewportPage?: (pageNumber: number) => void
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const textLayer = useRef<HTMLDivElement | null>(null)
  const latestSearchQuery = useRef(searchQuery)
  const latestActiveOccurrence = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  // 아직 안 그린 쪽은 자리만 잡아 둔다. 이 비율이 실제와 다르면 위쪽 쪽들이
  // 그려지면서 높이가 바뀌고, 쪽 이동으로 잡아 둔 스크롤 위치가 통째로
  // 어긋난다. 그래서 문서에서 잰 비율을 받아 쓰고, 자기 쪽을 그린 뒤에는
  // 잰 값으로 바꾼다.
  const [measuredRatio, setMeasuredRatio] = useState<number | null>(null)
  const ratio = measuredRatio ?? defaultRatio
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  async function copyPage() {
    if (!onCopy || copyState === 'copying') return
    setCopyState('copying')
    try {
      await onCopy(pageNumber)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1600)
    } catch {
      setCopyState('failed')
      window.setTimeout(() => setCopyState('idle'), 2200)
    }
  }

  useEffect(() => {
    latestSearchQuery.current = searchQuery
    latestActiveOccurrence.current = activeSearchPage ? activeSearchOccurrence : null
  }, [activeSearchOccurrence, activeSearchPage, searchQuery])

  useEffect(() => {
    const node = holder.current
    if (!node) return
    // 한 화면 앞뒤로 미리 그리고, 멀어진 쪽은 다시 비운다. 긴 강의록을 훑은 뒤에도
    // 지난 모든 고해상도 캔버스와 OCR 노드가 메모리에 쌓여 필기를 늦추지 않게 한다.
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '1600px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const node = holder.current
    if (!node || !onViewportPage) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onViewportPage(pageNumber)
      },
      { rootMargin: '-22% 0px -68% 0px', threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [onViewportPage, pageNumber])

  useEffect(() => {
    if (!visible) {
      // display:none만으로는 캔버스의 큰 backing store가 해제되지 않는다.
      const target = canvas.current
      if (target) {
        target.width = 1
        target.height = 1
      }
      textLayer.current?.replaceChildren()
      return
    }
    if (width <= 0) return
    let cancelled = false
    let task: { cancel: () => void } | null = null
    let textTask: pdfjs.TextLayer | null = null

    void (async () => {
      const page = await document.getPage(pageNumber)
      if (cancelled) return

      const base = page.getViewport({ scale: 1 })
      if (!cancelled) setMeasuredRatio(base.height / base.width)

      // 화면 배율만큼 키워 그려야 글자가 또렷하다. 다만 브라우저마다 캔버스
      // 최대 넓이가 있어서(특히 iOS 사파리) 그 선을 넘으면 그리기가 통째로
      // 실패하고 캔버스가 검게 남는다. 배율을 2배로 묶고, 그래도 총 픽셀이
      // 많으면 한도 안으로 다시 줄인다.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const MAX_PIXELS = 4_000_000
      const base1x = page.getViewport({ scale: width / base.width })
      const wanted = base1x.width * dpr * (base1x.height * dpr)
      const guard = wanted > MAX_PIXELS ? Math.sqrt(MAX_PIXELS / wanted) : 1
      const viewport = page.getViewport({ scale: (width / base.width) * dpr * guard })

      const target = canvas.current
      const context = target?.getContext('2d')
      if (!target || !context || cancelled) return

      target.width = Math.floor(viewport.width)
      target.height = Math.floor(viewport.height)
      target.style.width = '100%'
      target.style.height = 'auto'

      // PDF 는 배경을 스스로 칠하지 않는 경우가 있어 비워 두면 캔버스의 투명한
      // 바탕이 그대로 비친다. 흰 종이를 먼저 깔고 그 위에 그린다.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, target.width, target.height)

      const textTarget = textLayer.current
      if (textTarget) {
        textTarget.replaceChildren()
        textTarget.style.setProperty('--total-scale-factor', String(base1x.scale))
        textTask = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent({ includeMarkedContent: true }),
          container: textTarget,
          viewport: base1x,
        })
        void textTask.render().then(() => {
          if (!cancelled) {
            const activeMark = markTextLayer(
              textTarget,
              latestSearchQuery.current,
              latestActiveOccurrence.current,
            )
            activeMark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
        })
      }

      task = page.render({
        canvas: target,
        canvasContext: context,
        viewport,
        // PowerPoint에서 만든 일부 PDF는 PDF.js가 투명 바탕을 검게 합성한다.
        // 캔버스를 미리 칠하는 것만으로는 렌더 시작 시 다시 지워질 수 있어,
        // PDF.js 자체에도 종이 배경색을 명시한다.
        background: '#ffffff',
      })
      try {
        await (task as unknown as { promise: Promise<void> }).promise
      } catch {
        // 스크롤로 빠르게 지나가면 렌더가 취소된다. 오류가 아니다.
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
      textTask?.cancel()
    }
  }, [visible, width, document, pageNumber])

  useEffect(() => {
    if (textLayer.current) {
      const activeMark = markTextLayer(
        textLayer.current,
        searchQuery,
        activeSearchPage ? activeSearchOccurrence : null,
      )
      if (activeSearchPage) {
        activeMark?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    }
  }, [activeSearchOccurrence, activeSearchPage, searchQuery])

  const annotationActive = Boolean(annotationTool && onMarksChange)

  return (
    <div
      ref={holder}
      data-page={pageNumber}
      data-annotation-active={annotationActive ? '' : undefined}
      onPointerDownCapture={
        annotationActive
          ? (event) => {
              event.preventDefault()
              window.getSelection()?.removeAllRanges()
            }
          : undefined
      }
      onClickCapture={
        annotationActive
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
            }
          : undefined
      }
      onDoubleClickCapture={
        annotationActive
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
            }
          : undefined
      }
      onContextMenu={annotationActive ? (event) => event.preventDefault() : undefined}
      onCopy={annotationActive ? (event) => event.preventDefault() : undefined}
      onDragStart={annotationActive ? (event) => event.preventDefault() : undefined}
      className={`relative w-full scroll-mt-32 overflow-hidden rounded-lg border bg-white shadow-sm ${
        checked
          ? 'border-brand-500 ring-2 ring-brand-400/70'
          : activeSearchPage
            ? 'border-amber-400 ring-2 ring-amber-300/70'
            : 'border-slate-200 dark:border-slate-700'
      }`}
      style={{ aspectRatio: visible ? undefined : `1 / ${ratio}` }}
    >
      <canvas
        ref={canvas}
        draggable={false}
        className={
          visible
            ? 'block w-full bg-white'
            : 'invisible absolute inset-0 h-full w-full bg-white'
        }
      />
      <div ref={textLayer} className="lecture-pdf-text-layer" />
      {visible && (marks.length > 0 || onMarksChange) && (
        <PageMarkLayer
          key={annotationTool ?? 'view'}
          marks={marks}
          aspect={ratio}
          onChange={onMarksChange}
          tool={annotationTool}
          color={annotationColor}
          strokeWidth={annotationWidth}
          eraserRadius={eraserRadius}
          allowTouchDrawing={allowTouchDrawing}
          onInteract={onAnnotationInteract}
          // 페이지 안의 다른 요소는 필기 중 pointer-events가 꺼지므로 z-2면 충분하다.
          // 상단 sticky 도구막대(z-10)와 같게 올리면 스크롤된 페이지가 도구막대를
          // 덮어 버튼 터치를 필기로 가로채게 된다.
          className="z-[2]"
        />
      )}

      {selectable && (
        // 쪽 위에 얹되 글자 층을 가리지 않도록 왼쪽 위 모서리만 차지한다.
        <label className="absolute left-2 top-2 z-[3] flex cursor-pointer items-center gap-1.5 rounded-md bg-white/95 px-2 py-1 text-xs font-medium shadow-sm ring-1 ring-slate-300 dark:bg-slate-900/95 dark:ring-slate-600">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggle?.()}
            aria-label={`${pageNumber}쪽 선택`}
          />
          {pageNumber}쪽
        </label>
      )}

      {onCopy && !annotationActive && (
        <button
          type="button"
          onClick={() => void copyPage()}
          disabled={copyState === 'copying'}
          title={copyState === 'failed' ? '복사하지 못했습니다.' : '이 쪽을 풀이에 붙여넣기'}
          className="absolute bottom-1 left-2 z-[3] rounded bg-slate-900/70 px-2 py-1 text-[11px] font-medium text-white shadow-sm transition-colors hover:bg-slate-900 disabled:cursor-wait disabled:opacity-70"
        >
          {copyState === 'copying'
            ? '복사 중…'
            : copyState === 'copied'
              ? '복사됨 ✓'
              : copyState === 'failed'
                ? '복사 실패'
                : '복사'}
        </button>
      )}

      <span className="pointer-events-none absolute bottom-1 right-2 z-[2] rounded bg-slate-900/60 px-1.5 text-[11px] text-white">
        {pageNumber}
      </span>
    </div>
  )
}

export function LecturePdfViewer({
  storagePath,
  title,
  lectureId,
  annotationVariantId = null,
  allowPageCopy = true,
  professor = null,
  initialPage,
  initialQuery = '',
  paneMode = false,
  containedScroll = false,
  selectable = false,
  selectedPages,
  onTogglePage,
  onDocumentReady,
}: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const [pageTexts, setPageTexts] = useState<string[] | null>(null)
  const [searchInput, setSearchInput] = useState(initialQuery)
  const [searchQuery, setSearchQuery] = useState(initialQuery.trim())
  const [activeResult, setActiveResult] = useState(0)
  const [viewMode, setViewMode] = useState<'pdf' | 'compatible'>('compatible')
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>(null)
  const [annotationSettings, setAnnotationSettings] = useState(initialAnnotationSettings)
  const [allowTouchDrawing, setAllowTouchDrawing] = useState(initialTouchDrawing)
  const [lastAnnotationPage, setLastAnnotationPage] = useState<number | null>(null)
  const [activeAnnotationPage, setActiveAnnotationPage] = useState<number | null>(initialPage ?? null)
  const [pageInput, setPageInput] = useState('')
  const [zoom, setZoom] = useState(100)
  const [showBrushSettings, setShowBrushSettings] = useState(false)
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const root = useRef<HTMLDivElement | null>(null)
  const column = useRef<HTMLDivElement | null>(null)
  const searchBox = useRef<HTMLInputElement | null>(null)

  const selectedSet = useMemo(() => new Set(selectedPages ?? []), [selectedPages])
  const annotationEnabled = Boolean(lectureId && !selectable)
  const annotations = useLecturePdfAnnotations(lectureId, annotationVariantId, annotationEnabled)
  const {
    penColor,
    highlightColor,
    pencilColor,
    size: annotationSize,
    pencilSize,
    eraserSize,
  } = annotationSettings
  const annotationColor =
    annotationTool === 'highlight'
      ? highlightColor
      : annotationTool === 'pencil'
        ? pencilColor
        : penColor
  const annotationPalette = annotationTool === 'highlight' ? HIGHLIGHT_COLORS : PEN_COLORS
  const annotationColorLabel =
    annotationPalette.find((item) => item.value === annotationColor)?.label ?? '직접 선택'
  const usesCustomAnnotationColor = !annotationPalette.some(
    (item) => item.value === annotationColor,
  )
  const annotationWidth =
    annotationTool === 'highlight'
      ? HIGHLIGHT_WIDTHS[annotationSize]
      : annotationTool === 'pencil'
        ? PENCIL_WIDTHS[pencilSize]
        : PEN_WIDTHS[annotationSize]
  const targetAnnotationPage = activeAnnotationPage ?? lastAnnotationPage
  const targetAnnotationMarks = targetAnnotationPage
    ? (annotations.pages[targetAnnotationPage] ?? [])
    : []
  const canUndoTargetPage = targetAnnotationPage
    ? annotations.canUndoPage(targetAnnotationPage)
    : false
  const canRedoTargetPage = targetAnnotationPage
    ? annotations.canRedoPage(targetAnnotationPage)
    : false
  const annotatedPageCount = useMemo(
    () => Object.values(annotations.pages).filter((marks) => marks.length > 0).length,
    [annotations.pages],
  )

  const copyPage = useCallback(
    async (pageNumber: number) => {
      if (!document || !lectureId) throw new Error('강의록 정보를 확인하지 못했습니다.')
      await writeLecturePageClipboard(
        { lectureId, page: pageNumber, title, professor },
        renderLecturePageToBlob(document, pageNumber, 'image/png'),
      )
    },
    [document, lectureId, professor, title],
  )

  useEffect(() => {
    onDocumentReady?.(document)
  }, [document, onDocumentReady])

  useEffect(() => {
    window.localStorage.setItem(ANNOTATION_SETTINGS_STORAGE_KEY, JSON.stringify(annotationSettings))
  }, [annotationSettings])
  // 브라우저 기본 PDF 뷰어(iframe) 위에는 필기층이나 체크칸을 얹을 수 없다.
  // 쪽 선택 또는 필기 중에는 우리가 그리는 페이지 화면으로 고정한다.
  const effectiveMode = selectable || annotationTool ? 'compatible' : viewMode

  useEffect(() => {
    const node = column.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let created: string | null = null
    let task: PDFDocumentLoadingTask | null = null

    void (async () => {
      try {
        const url = await getSignedUrl(storagePath)
        if (!url) throw new Error('열람 권한을 확인하지 못했습니다.')

        // 읽기 URL 이 5분짜리라, 보는 동안 조각내어 받으면 도중에 만료된다.
        // 그래서 한 번에 받아 두고 그 뒤로는 네트워크를 쓰지 않는다. 내려받기
        // 버튼도 이미 받아 둔 이 바이트를 그대로 쓴다.
        const response = await fetch(url)
        if (!response.ok) throw new Error(`강의록을 받지 못했습니다 (${response.status})`)

        const total = Number(response.headers.get('Content-Length') ?? 0)
        const reader = response.body?.getReader()
        let bytes: Uint8Array

        if (reader) {
          const chunks: Uint8Array[] = []
          let received = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            received += value.length
            if (total && !cancelled) setProgress(Math.round((received / total) * 100))
          }
          bytes = new Uint8Array(received)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
          }
        } else {
          bytes = new Uint8Array(await response.arrayBuffer())
        }

        if (cancelled) return

        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer
        created = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }))
        setBlobUrl(created)

        // getDocument 는 넘긴 바이트 배열을 소유해 비워 버린다. 사본을 넘기지
        // 않으면 위에서 만든 Blob 이 함께 비어 내려받기가 0바이트가 된다.
        const loading = pdfjs.getDocument({
          data: new Uint8Array(buffer.slice(0)),
          cMapUrl: `${PDFJS_ASSET_ROOT}/cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDFJS_ASSET_ROOT}/standard_fonts/`,
          wasmUrl: `${PDFJS_ASSET_ROOT}/wasm/`,
          // 글꼴 파일을 포함하지 않은 오래된 PDF는 기기에 설치된 글꼴 또는
          // PDF.js 대체 글꼴을 사용해야 내용이 사라지지 않는다.
          useSystemFonts: true,
        })
        task = loading
        const loaded = await loading.promise
        if (cancelled) {
          void loading.destroy()
          return
        }
        setDocument(loaded)
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '강의록을 열지 못했습니다.')
        }
      }
    })()

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
      // 워커와 열린 요청까지 정리하려면 문서가 아니라 로딩 작업을 닫아야 한다.
      if (task) void task.destroy()
    }
  }, [storagePath])

  const pages = useMemo(
    () => (document ? Array.from({ length: document.numPages }, (_, index) => index + 1) : []),
    [document],
  )

  // 브라우저 기본 찾기는 아직 화면에 그리지 않은 PDF 쪽을 찾지 못한다. PDF.js가
  // 가진 텍스트를 한 번만 읽어 전체 문서 검색용 메모리 색인을 만든다.
  useEffect(() => {
    if (!document) return
    let active = true
    void (async () => {
      const texts = new Array<string>(document.numPages)
      let cursor = 0
      const worker = async () => {
        for (;;) {
          const index = cursor
          cursor += 1
          if (index >= document.numPages || !active) return
          const page = await document.getPage(index + 1)
          const content = await page.getTextContent()
          texts[index] = content.items
            .map((item) => ('str' in item ? item.str : ''))
            .join(' ')
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, document.numPages) }, worker))
      if (active) setPageTexts(texts)
    })()
    return () => {
      active = false
    }
  }, [document])

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const searchHits = useMemo<SearchHit[]>(() => {
    if (!pageTexts || !searchQuery) return []
    return pageTexts.flatMap((text, index) => {
      const count = countLectureSearchMatches(text, searchQuery)
      return Array.from({ length: count }, (_, occurrenceIndex) => ({
        pageNumber: index + 1,
        occurrenceIndex,
      }))
    })
  }, [pageTexts, searchQuery])

  const searchPageNumbers = useMemo(
    () => new Set(searchHits.map((hit) => hit.pageNumber)),
    [searchHits],
  )

  // 강의록은 거의 전부 가로 슬라이드인데 자리표시자는 A4 세로로 잡혀 있었다.
  // 쪽마다 크기가 다른 문서는 드물어, 첫 쪽을 재서 기본값으로 쓰면 아직 안 그린
  // 쪽들도 실제와 비슷한 높이를 차지한다. 그려야 알 수 있는 게 아니라 쪽 정보만
  // 읽으면 되므로 값이 싸다.
  const [defaultRatio, setDefaultRatio] = useState(1.414)
  useEffect(() => {
    if (!document) return
    let active = true
    void document
      .getPage(1)
      .then((page) => {
        const viewport = page.getViewport({ scale: 1 })
        if (active && viewport.width > 0 && viewport.height > 0) {
          setDefaultRatio(viewport.height / viewport.width)
        }
      })
      .catch(() => {
        // 못 재면 기본값 그대로 둔다. 자리만 어긋날 뿐 보기에는 지장이 없다.
      })
    return () => {
      active = false
    }
  }, [document])

  // 옮겨 간 뒤에도 위쪽 쪽들이 그려지면서 높이가 조금씩 바뀐다. 자리가 잡힐
  // 때까지 두어 번 더 맞춘다. 새로 옮기면 이전 보정은 취소한다.
  const scrollCorrections = useRef<number[]>([])
  const scrollToPage = useCallback((pageNumber: number) => {
    for (const timer of scrollCorrections.current) window.clearTimeout(timer)
    const run = () => {
      const target = root.current?.querySelector(`[data-page="${pageNumber}"]`)
      target?.scrollIntoView({ block: 'start' })
    }
    run()
    scrollCorrections.current = [
      window.setTimeout(run, 120),
      window.setTimeout(run, 400),
    ]
  }, [])

  useEffect(() => () => {
    for (const timer of scrollCorrections.current) window.clearTimeout(timer)
  }, [])

  const noteViewportPage = useCallback((pageNumber: number) => {
    setActiveAnnotationPage(pageNumber)
  }, [])

  const goToPage = useCallback(() => {
    if (!document) return
    const typed = Number(pageInput.trim())
    if (!Number.isFinite(typed) || pageInput.trim() === '') return
    // 89쪽짜리에 200 을 넣었다고 아무 일도 안 일어나면 입력이 고장난 것처럼
    // 보인다. 있는 쪽 중 가장 가까운 곳으로 데려간다.
    const pageNumber = Math.min(Math.max(Math.round(typed), 1), document.numPages)
    setActiveAnnotationPage(pageNumber)
    scrollToPage(pageNumber)
    setPageInput('')
  }, [document, pageInput, scrollToPage])

  // 새 검색어는 현재 스크롤 위치와 무관하게 문서의 첫 번째 일치 항목부터
  // 시작한다. 이전에는 URL의 초기 쪽을 기준으로 잡아 끝에서 위로 돌아가는 것처럼
  // 보일 수 있었다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActiveResult(0)
      if (searchHits.length > 0) scrollToPage(searchHits[0].pageNumber)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [scrollToPage, searchHits])

  const moveSearch = useCallback(
    (step: number) => {
      if (searchHits.length === 0) return
      const next = Math.max(0, Math.min(activeResult + step, searchHits.length - 1))
      setActiveResult(next)
      scrollToPage(searchHits[next].pageNumber)
    },
    [activeResult, scrollToPage, searchHits],
  )

  useEffect(() => {
    const handleFind = (event: KeyboardEvent) => {
      if (effectiveMode !== 'compatible') return
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        searchBox.current?.focus()
        searchBox.current?.select()
      } else if (event.key === 'Enter' && window.document.activeElement === searchBox.current) {
        event.preventDefault()
        moveSearch(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleFind)
    return () => window.removeEventListener('keydown', handleFind)
  }, [effectiveMode, moveSearch])

  // 풀이에서 "127쪽" 처럼 가리켜 들어온 경우 그 자리로 옮겨 준다. 아직 안 그린
  // 쪽도 자리는 잡혀 있어 스크롤이 제대로 닿는다.
  useEffect(() => {
    if (!document || !initialPage || initialPage < 1 || initialPage > document.numPages) return
    const timer = setTimeout(() => {
      const target = window.document.querySelector(`[data-page="${initialPage}"]`)
      target?.scrollIntoView({ block: 'start' })
    }, 60)
    return () => clearTimeout(timer)
  }, [document, initialPage])

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (!annotationTool || !targetAnnotationPage || (!event.metaKey && !event.ctrlKey)) return
      if (event.key.toLocaleLowerCase() !== 'z') return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return
      }
      const redo = event.shiftKey
      if (redo ? !canRedoTargetPage : !canUndoTargetPage) return
      event.preventDefault()
      if (redo) annotations.redoPage(targetAnnotationPage)
      else annotations.undoPage(targetAnnotationPage)
    }
    window.addEventListener('keydown', handleHistoryShortcut)
    return () => window.removeEventListener('keydown', handleHistoryShortcut)
  }, [
    annotationTool,
    annotations,
    canRedoTargetPage,
    canUndoTargetPage,
    targetAnnotationPage,
  ])

  function selectAnnotationTool(tool: AnnotationTool) {
    if (!annotations.available || annotations.status === 'loading' || annotations.loadFailed) return
    if (tool) {
      window.getSelection()?.removeAllRanges()
      setViewMode('compatible')
    }
    setAnnotationTool(tool)
  }

  function changeAnnotationColor(color: string) {
    setAnnotationSettings((current) => {
      if (annotationTool === 'highlight') return { ...current, highlightColor: color }
      if (annotationTool === 'pencil') return { ...current, pencilColor: color }
      return { ...current, penColor: color }
    })
  }

  function toggleTouchDrawing() {
    const next = !allowTouchDrawing
    setAllowTouchDrawing(next)
    window.localStorage.setItem(TOUCH_DRAWING_STORAGE_KEY, String(next))
  }

  function updatePageMarks(pageNumber: number, marks: PageMark[]) {
    setLastAnnotationPage(pageNumber)
    setActiveAnnotationPage(pageNumber)
    annotations.updatePage(pageNumber, marks)
  }

  function clearTargetAnnotationPage() {
    if (!targetAnnotationPage || targetAnnotationMarks.length === 0) return
    if (!window.confirm(`${targetAnnotationPage}쪽의 필기를 모두 지울까요?`)) return
    updatePageMarks(targetAnnotationPage, [])
  }

  function resolveAnnotationConflict(choice: 'server' | 'mine' | 'combine') {
    const conflict = annotations.conflict
    if (!conflict) return
    if (
      choice === 'server' &&
      !window.confirm(`${conflict.pageNumber}쪽의 이 기기 필기를 버리고 서버 필기를 사용할까요?`)
    ) {
      return
    }
    if (
      choice === 'mine' &&
      !window.confirm(`${conflict.pageNumber}쪽의 다른 기기 필기를 이 기기 필기로 덮어쓸까요?`)
    ) {
      return
    }
    annotations.resolveConflict(conflict.pageNumber, choice)
    setLastAnnotationPage(conflict.pageNumber)
  }

  async function downloadAnnotatedPdf() {
    if (!blobUrl || exportState.status === 'working' || annotatedPageCount === 0) return
    setExportState({ status: 'working', completed: 0, total: annotatedPageCount })
    try {
      const response = await fetch(blobUrl)
      if (!response.ok) throw new Error('원본 PDF를 다시 읽지 못했습니다.')
      const [{ exportAnnotatedLecturePdf }, bytes] = await Promise.all([
        import('@/components/lecture/exportAnnotatedLecturePdf'),
        response.arrayBuffer(),
      ])
      const output = await exportAnnotatedLecturePdf({
        bytes,
        annotations: annotations.pages,
        onProgress: ({ completed, total }) =>
          setExportState({ status: 'working', completed, total }),
      })
      const url = URL.createObjectURL(output)
      const anchor = window.document.createElement('a')
      anchor.href = url
      anchor.download = `${title.replace(/[\\/:*?"<>|]/g, '_')} (필기 포함).pdf`
      window.document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      setExportState({ status: 'idle' })
    } catch (caught) {
      setExportState({
        status: 'error',
        message: caught instanceof Error ? caught.message : '필기 포함 PDF를 만들지 못했습니다.',
      })
    }
  }

  const sourceActions = blobUrl ? (
    <span className="flex shrink-0 items-center gap-1.5">
      <a
        href={blobUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
      >
        원본 열기
      </a>
      <a
        href={blobUrl}
        download={`${title}.pdf`}
        className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-700"
      >
        원본 내려받기
      </a>
      {annotationEnabled && annotatedPageCount > 0 && (
        <button
          type="button"
          onClick={() => void downloadAnnotatedPdf()}
          disabled={exportState.status === 'working'}
          title={exportState.status === 'error' ? exportState.message : '현재 필기를 PDF에 포함해 저장'}
          className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          {exportState.status === 'working'
            ? `PDF 만드는 중 ${exportState.completed}/${exportState.total}`
            : exportState.status === 'error'
              ? '내보내기 재시도'
              : '필기 포함 저장'}
        </button>
      )}
    </span>
  ) : null

  return (
    <div
      ref={root}
      className="flex flex-col gap-3"
      data-auto-update-blocker={annotationTool || annotations.hasUnsavedChanges ? '' : undefined}
    >
      <div
        className={`sticky z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 ${
          containedScroll ? 'top-0' : paneMode ? 'top-[6.75rem] lg:top-0' : 'top-16'
        }`}
      >
        {paneMode && (
          <span className="text-sm font-bold text-brand-800 dark:text-brand-200">
            PDF 강의록
          </span>
        )}
        {document && (
          <span className="text-sm text-slate-500 dark:text-slate-400">총 {document.numPages}쪽</span>
        )}
        {document && effectiveMode === 'compatible' && (
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              goToPage()
            }}
          >
            <input
              type="number"
              min={1}
              max={document.numPages}
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
              placeholder={String(activeAnnotationPage ?? 1)}
              aria-label="이동할 쪽 번호"
              title={`지금 ${activeAnnotationPage ?? 1}쪽. 갈 쪽 번호를 적으세요.`}
              className="h-8 w-16 rounded-md border border-slate-300 bg-white px-1.5 text-center text-xs outline-none focus:border-brand-500 dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="submit"
              // 회색 숫자는 지금 쪽을 알려 주는 자리글이지 값이 아니다. 비어 있는
              // 채로 누르면 아무 일도 안 일어나 입력이 고장난 것처럼 보였다.
              disabled={pageInput.trim() === ''}
              className="h-8 rounded-md border border-slate-300 px-2 text-xs font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-slate-600 dark:hover:bg-slate-800"
            >
              이동
            </button>
          </form>
        )}
        <span className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => {
              setAnnotationTool(null)
              setViewMode('pdf')
            }}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              viewMode === 'pdf'
                ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            원본 PDF 보기
          </button>
          <button
            type="button"
            onClick={() => setViewMode('compatible')}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              viewMode === 'compatible'
                ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            페이지 전체 보기
          </button>
        </span>
        {effectiveMode === 'compatible' && (
          <>
            <div className="relative min-w-[220px] flex-1 sm:max-w-md">
              <input
                ref={searchBox}
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="강의록 안에서 찾기 (⌘/Ctrl+F)"
                aria-label="강의록 안에서 찾기"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 pr-24 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-800 dark:focus:ring-brand-900"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                {!document || (document && !pageTexts)
                  ? '색인 중…'
                  : !searchQuery
                    ? ''
                    : searchHits.length === 0
                      ? '0/0'
                      : `${Math.min(activeResult + 1, searchHits.length)}/${searchHits.length}`}
              </span>
            </div>
            <button
              type="button"
              onClick={() => moveSearch(-1)}
              disabled={searchHits.length === 0 || activeResult <= 0}
              aria-label="이전 검색 결과"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-35 dark:border-slate-600"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveSearch(1)}
              disabled={searchHits.length === 0 || activeResult >= searchHits.length - 1}
              aria-label="다음 검색 결과"
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm disabled:opacity-35 dark:border-slate-600"
            >
              ↓
            </button>
            <label className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-600">
              확대
              <select
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                aria-label="PDF 확대 비율"
                className="bg-transparent font-semibold outline-none"
              >
                {[75, 90, 100, 110, 125, 150, 175, 200].map((value) => (
                  <option key={value} value={value}>{value}%</option>
                ))}
              </select>
            </label>
          </>
        )}
        {!annotationEnabled && sourceActions && <span className="ml-auto">{sourceActions}</span>}
        {annotationEnabled && (
          <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2 dark:border-slate-700">
            <span className="mr-1 text-xs font-bold text-slate-600 dark:text-slate-300">필기</span>
            <AnnotationToolButton
              active={annotationTool === null}
              disabled={!annotations.available || annotations.status === 'loading' || annotations.loadFailed}
              onClick={() => selectAnnotationTool(null)}
            >
              보기
            </AnnotationToolButton>
            <AnnotationToolButton
              active={annotationTool === 'pen'}
              disabled={!annotations.available || annotations.status === 'loading' || annotations.loadFailed}
              onClick={() => selectAnnotationTool('pen')}
            >
              펜
            </AnnotationToolButton>
            <AnnotationToolButton
              active={annotationTool === 'highlight'}
              disabled={!annotations.available || annotations.status === 'loading' || annotations.loadFailed}
              onClick={() => selectAnnotationTool('highlight')}
            >
              형광펜
            </AnnotationToolButton>
            <AnnotationToolButton
              active={annotationTool === 'pencil'}
              disabled={!annotations.available || annotations.status === 'loading' || annotations.loadFailed}
              onClick={() => selectAnnotationTool('pencil')}
            >
              색연필
            </AnnotationToolButton>
            <AnnotationToolButton
              active={annotationTool === 'erase'}
              disabled={!annotations.available || annotations.status === 'loading' || annotations.loadFailed}
              onClick={() => selectAnnotationTool('erase')}
            >
              부분 지우개
            </AnnotationToolButton>
            <AnnotationToolButton
              active={annotationTool === 'lasso'}
              disabled={!annotations.available || annotations.status === 'loading' || annotations.loadFailed}
              onClick={() => selectAnnotationTool('lasso')}
            >
              올가미·이동
            </AnnotationToolButton>
            {annotationTool === 'lasso' && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                둘러서 선택한 뒤 선택 상자를 끌어 이동
              </span>
            )}
            {annotationTool === 'erase' && (
              <span
                className="ml-1 inline-flex rounded-md bg-slate-100 p-0.5 dark:bg-slate-800"
                role="group"
                aria-label="부분 지우개 크기"
              >
                {['작게', '보통', '크게'].map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAnnotationSettings((current) => ({ ...current, eraserSize: index }))}
                    aria-pressed={eraserSize === index}
                    className={`min-h-8 rounded px-2 py-1 text-[11px] ${
                      eraserSize === index
                        ? 'bg-white font-semibold text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}

            {(annotationTool === 'pen' || annotationTool === 'highlight' || annotationTool === 'pencil') && (
              <>
                <button
                  type="button"
                  onClick={() => setShowBrushSettings((current) => !current)}
                  aria-expanded={showBrushSettings}
                  className="min-h-8 rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium sm:hidden dark:border-slate-600"
                >
                  색·굵기 {showBrushSettings ? '접기' : '열기'}
                </button>
                <div className={`${showBrushSettings ? 'flex' : 'hidden'} w-full flex-wrap items-center gap-1 sm:contents`}>
                <span
                  className="ml-1 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/70"
                  role="group"
                  aria-label={`${annotationTool === 'highlight' ? '형광펜' : annotationTool === 'pencil' ? '색연필' : '펜'} 색상: ${annotationColorLabel}`}
                >
                  {annotationPalette.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => changeAnnotationColor(item.value)}
                      aria-label={`${item.label}색`}
                      aria-pressed={annotationColor === item.value}
                      title={`${item.label}색`}
                      className="group/color grid h-8 w-8 touch-manipulation place-items-center rounded-md outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-700"
                    >
                      <span
                        aria-hidden="true"
                        style={{ backgroundColor: item.value }}
                        className={`relative grid h-5 w-5 place-items-center rounded-full border border-black/10 shadow-sm transition-transform group-hover/color:scale-110 ${
                          annotationColor === item.value
                            ? 'ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-slate-800'
                            : ''
                        }`}
                      >
                        {annotationColor === item.value && (
                          <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-brand-600 text-[9px] font-black leading-none text-white ring-1 ring-white">
                            ✓
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                  <label
                    title="다른 색 직접 선택"
                    className="relative grid h-8 w-8 cursor-pointer touch-manipulation place-items-center rounded-md outline-none hover:bg-white focus-within:ring-2 focus-within:ring-brand-500 dark:hover:bg-slate-700"
                  >
                    <input
                      type="color"
                      value={annotationColor}
                      onChange={(event) => changeAnnotationColor(event.target.value)}
                      aria-label="다른 색 직접 선택"
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                    <span
                      aria-hidden="true"
                      className={`grid h-5 w-5 place-items-center rounded-full border border-white text-sm font-bold text-white shadow-sm ${
                        usesCustomAnnotationColor
                          ? 'ring-2 ring-brand-500 ring-offset-2 dark:ring-offset-slate-800'
                          : 'ring-1 ring-slate-300'
                      }`}
                      style={{
                        background: usesCustomAnnotationColor
                          ? annotationColor
                          : 'conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)',
                      }}
                    >
                      {usesCustomAnnotationColor ? '✓' : '+'}
                    </span>
                  </label>
                </span>
                {annotationTool === 'pencil' ? (
                  <span
                    className="ml-1 inline-flex flex-wrap rounded-md bg-slate-100 p-0.5 dark:bg-slate-800"
                    role="group"
                    aria-label="색연필 굵기 1부터 10"
                  >
                    {PENCIL_WIDTHS.map((value, index) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setAnnotationSettings((current) => ({ ...current, pencilSize: index }))}
                        aria-pressed={pencilSize === index}
                        aria-label={`색연필 굵기 ${index + 1}`}
                        title={`굵기 ${index + 1} · 약 ${(value * 1000).toFixed(2)}px`}
                        className={`grid min-h-8 min-w-7 place-items-center rounded px-1 py-1 text-[11px] ${
                          pencilSize === index
                            ? 'bg-white font-semibold text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </span>
                ) : (
                  <span className="ml-1 inline-flex rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
                    {['얇게', '보통', '굵게'].map((label, index) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setAnnotationSettings((current) => ({ ...current, size: index }))}
                      aria-pressed={annotationSize === index}
                      className={`min-h-8 rounded px-2 py-1 text-[11px] ${
                        annotationSize === index
                          ? 'bg-white font-semibold text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  </span>
                )}
                </div>
              </>
            )}

            {annotationTool && (
              <button
                type="button"
                onClick={toggleTouchDrawing}
                aria-pressed={allowTouchDrawing}
                title="꺼짐: Apple Pencil·마우스만 필기하고 손가락은 스크롤합니다."
                className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                  allowTouchDrawing
                    ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
                    : 'border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                }`}
              >
                손가락 필기 {allowTouchDrawing ? '켬' : '끔'}
              </button>
            )}

            {targetAnnotationPage &&
              (targetAnnotationMarks.length > 0 || canUndoTargetPage || canRedoTargetPage) && (
              <span className="ml-1 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                {targetAnnotationPage}쪽
                <button
                  type="button"
                  onClick={() => annotations.undoPage(targetAnnotationPage)}
                  disabled={!canUndoTargetPage}
                  className="rounded-md border border-slate-300 px-2 py-1 font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-slate-600 dark:hover:bg-slate-800"
                >
                  되돌리기
                </button>
                {canRedoTargetPage && (
                  <button
                    type="button"
                    onClick={() => annotations.redoPage(targetAnnotationPage)}
                    className="rounded-md border border-slate-300 px-2 py-1 font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    다시실행
                  </button>
                )}
                {targetAnnotationMarks.length > 0 && (
                  <button
                    type="button"
                    onClick={clearTargetAnnotationPage}
                    className="rounded-md border border-rose-300 px-2 py-1 font-medium text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  >
                    이 쪽 필기 모두 지우기
                  </button>
                )}
              </span>
            )}

            <span
              aria-live="polite"
              className="ml-auto text-[11px] text-slate-500 dark:text-slate-400"
            >
              {annotations.status === 'loading'
                ? '필기 불러오는 중…'
                : annotations.status === 'conflict'
                  ? `다른 기기 수정 감지${annotations.conflictCount > 1 ? ` ${annotations.conflictCount}건` : ''}`
                : annotations.remoteUpdate
                  ? `${annotations.remoteUpdate.pageNumber}쪽 실시간 반영 ✓`
                : annotations.realtimeStatus === 'disconnected'
                  ? '실시간 연결 끊김'
                : annotations.status === 'saving'
                  ? '저장 중…'
                  : annotations.status === 'saved'
                    ? '저장됨 ✓'
                    : annotations.status === 'error'
                      ? '저장 실패'
                      : '계정에 자동 저장'}
            </span>
            {annotations.status === 'error' && (
              <button
                type="button"
                onClick={annotations.retrySave}
                title={annotations.error ?? undefined}
                className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700"
              >
                다시 시도
              </button>
            )}
            {annotations.realtimeStatus === 'disconnected' && (
              <button
                type="button"
                onClick={annotations.retryRealtime}
                className="rounded-md border border-amber-400 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
              >
                실시간 다시 연결
              </button>
            )}
            {sourceActions}
          </div>
        )}
      </div>

      {annotations.conflict && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-bold">
              {annotations.conflict.pageNumber}쪽이 다른 기기나 탭에서도 수정되었습니다.
            </span>
            <span className="text-xs text-amber-800 dark:text-amber-200">
              어느 필기도 자동으로 덮어쓰지 않고 임시 보관 중입니다.
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => resolveAnnotationConflict('combine')}
                className="rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
              >
                둘 다 합치기
              </button>
              <button
                type="button"
                onClick={() => resolveAnnotationConflict('mine')}
                className="rounded-md border border-amber-500 bg-white px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:bg-amber-950"
              >
                이 기기 필기 사용
              </button>
              <button
                type="button"
                onClick={() => resolveAnnotationConflict('server')}
                className="rounded-md border border-amber-400 px-2.5 py-1.5 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/60"
              >
                서버 필기 사용
              </button>
            </span>
          </div>
        </div>
      )}
      {!annotations.conflict && annotations.remoteUpdate && (
        <div
          role="status"
          className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200"
        >
          다른 기기나 탭에서 저장한 {annotations.remoteUpdate.pageNumber}쪽 필기를 실시간으로 반영했습니다.
        </div>
      )}

      <div className={effectiveMode === 'compatible' ? 'overflow-x-auto pb-2' : undefined}>
      <div
        ref={column}
        className="mx-auto flex flex-col gap-3 transition-[width] duration-150"
        style={
          effectiveMode === 'compatible' && document
            ? { width: `${zoom}%` }
            : undefined
        }
      >
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        ) : !document ? (
          <div className="flex flex-col items-center gap-2 py-16">
            <Spinner className="h-7 w-7" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {progress > 0 ? `강의록을 받는 중… ${progress}%` : '강의록을 여는 중…'}
            </p>
          </div>
        ) : effectiveMode === 'pdf' && blobUrl ? (
          <iframe
            title={title}
            src={`${blobUrl}#page=${initialPage ?? 1}&view=FitH${initialQuery ? `&search=${encodeURIComponent(initialQuery)}` : ''}`}
            className="h-[calc(100vh-10rem)] min-h-[680px] w-full rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700"
          />
        ) : (
          pages.map((pageNumber) => (
            <PdfPage
              key={pageNumber}
              document={document}
              pageNumber={pageNumber}
              width={width}
              selectable={selectable}
              checked={selectedSet.has(pageNumber)}
              onToggle={() => onTogglePage?.(pageNumber)}
              onCopy={lectureId && allowPageCopy ? copyPage : undefined}
              marks={annotations.pages[pageNumber] ?? []}
              annotationTool={annotationTool}
              annotationColor={annotationColor}
              annotationWidth={annotationWidth}
              eraserRadius={ERASER_RADII[eraserSize]}
              allowTouchDrawing={allowTouchDrawing}
              onMarksChange={
                annotations.available && !annotations.loadFailed
                  ? (marks) => updatePageMarks(pageNumber, marks)
                  : undefined
              }
              onAnnotationInteract={() => {
                setLastAnnotationPage(pageNumber)
                setActiveAnnotationPage(pageNumber)
              }}
              onViewportPage={noteViewportPage}
              defaultRatio={defaultRatio}
              // 여러 낱말 중 일부만 있는 쪽은 결과가 아니므로 부분 강조도 하지 않는다.
              searchQuery={searchPageNumbers.has(pageNumber) ? searchQuery : ''}
              activeSearchPage={searchHits[activeResult]?.pageNumber === pageNumber}
              activeSearchOccurrence={
                searchHits[activeResult]?.pageNumber === pageNumber
                  ? searchHits[activeResult].occurrenceIndex
                  : null
              }
            />
          ))
        )}
      </div>
      </div>
    </div>
  )
}

function AnnotationToolButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-8 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-40 ${
        active
          ? 'bg-brand-600 text-white shadow-sm'
          : 'border border-slate-300 text-slate-600 hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-200'
      }`}
    >
      {children}
    </button>
  )
}
