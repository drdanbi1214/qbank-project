import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { Spinner } from '@/components/ui/Spinner'
import { getSignedUrl } from '@/lib/storage'

// 워커는 번들러가 별도 파일로 뽑아 준다. CDN 을 가리키면 버전이 어긋나는 순간
// 조용히 렌더가 멈추므로 설치된 패키지에서 직접 가져온다.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type Props = {
  storagePath: string
  title: string
  initialPage?: number | null
  initialQuery?: string
}

type SearchHit = { pageNumber: number; occurrenceIndex: number }

function countMatches(text: string, query: string): number {
  if (!query) return 0
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  let cursor = 0
  let count = 0
  while ((cursor = haystack.indexOf(needle, cursor)) >= 0) {
    count += 1
    cursor += needle.length
  }
  return count
}

function markTextLayer(container: HTMLDivElement, query: string, activeOccurrence: number | null) {
  const needle = query.trim().toLocaleLowerCase()
  let occurrenceIndex = 0
  let activeMark: HTMLElement | null = null
  for (const span of container.querySelectorAll<HTMLSpanElement>('span')) {
    // markedContent를 감싼 PDF.js 부모 span만 건너뛴다. 우리가 앞선 검색에서
    // 넣은 mark는 원문으로 되돌린 뒤 새 검색어에 맞춰 다시 만든다.
    if ([...span.children].some((child) => child.tagName === 'SPAN')) continue
    const source = span.dataset.sourceText ?? span.textContent ?? ''
    span.dataset.sourceText = source
    span.replaceChildren(source)
    if (!needle) continue

    const lower = source.toLocaleLowerCase()
    let cursor = 0
    let found = lower.indexOf(needle)
    if (found < 0) continue

    const fragment = window.document.createDocumentFragment()
    while (found >= 0) {
      if (found > cursor) fragment.append(source.slice(cursor, found))
      const mark = window.document.createElement('mark')
      mark.className = `lecture-pdf-search-hit${
        occurrenceIndex === activeOccurrence ? ' lecture-pdf-search-hit-active' : ''
      }`
      if (occurrenceIndex === activeOccurrence) activeMark = mark
      mark.textContent = source.slice(found, found + query.trim().length)
      fragment.append(mark)
      occurrenceIndex += 1
      cursor = found + query.trim().length
      found = lower.indexOf(needle, cursor)
    }
    if (cursor < source.length) fragment.append(source.slice(cursor))
    span.replaceChildren(fragment)
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
}: {
  document: PDFDocumentProxy
  pageNumber: number
  width: number
  searchQuery: string
  activeSearchPage: boolean
  activeSearchOccurrence: number | null
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const textLayer = useRef<HTMLDivElement | null>(null)
  const latestSearchQuery = useRef(searchQuery)
  const latestActiveOccurrence = useRef<number | null>(null)
  const [visible, setVisible] = useState(false)
  const [ratio, setRatio] = useState(1.414) // A4 세로 비율. 실제 크기를 알기 전 자리만 잡는다.

  useEffect(() => {
    latestSearchQuery.current = searchQuery
    latestActiveOccurrence.current = activeSearchPage ? activeSearchOccurrence : null
  }, [activeSearchOccurrence, activeSearchPage, searchQuery])

  useEffect(() => {
    const node = holder.current
    if (!node || visible) return
    // 한 화면 앞뒤로 미리 그려 두면 스크롤이 빈 칸을 지나가지 않는다.
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && setVisible(true),
      { rootMargin: '1200px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || width <= 0) return
    let cancelled = false
    let task: { cancel: () => void } | null = null
    let textTask: pdfjs.TextLayer | null = null

    void (async () => {
      const page = await document.getPage(pageNumber)
      if (cancelled) return

      const base = page.getViewport({ scale: 1 })
      if (!cancelled) setRatio(base.height / base.width)

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

      task = page.render({ canvas: target, canvasContext: context, viewport })
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

  return (
    <div
      ref={holder}
      data-page={pageNumber}
      className={`relative w-full scroll-mt-32 overflow-hidden rounded-lg border bg-white shadow-sm ${
        activeSearchPage
          ? 'border-amber-400 ring-2 ring-amber-300/70'
          : 'border-slate-200 dark:border-slate-700'
      }`}
      style={{ aspectRatio: visible ? undefined : `1 / ${ratio}` }}
    >
      <canvas ref={canvas} className="block w-full" />
      <div ref={textLayer} className="lecture-pdf-text-layer" />
      <span className="pointer-events-none absolute bottom-1 right-2 z-[2] rounded bg-slate-900/60 px-1.5 text-[11px] text-white">
        {pageNumber}
      </span>
    </div>
  )
}

export function LecturePdfViewer({ storagePath, title, initialPage, initialQuery = '' }: Props) {
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
  const column = useRef<HTMLDivElement | null>(null)
  const searchBox = useRef<HTMLInputElement | null>(null)

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
        const loading = pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) })
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
      const count = countMatches(text, searchQuery)
      return Array.from({ length: count }, (_, occurrenceIndex) => ({
        pageNumber: index + 1,
        occurrenceIndex,
      }))
    })
  }, [pageTexts, searchQuery])

  const scrollToPage = useCallback((pageNumber: number) => {
    const target = window.document.querySelector(`[data-page="${pageNumber}"]`)
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [])

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
      if (viewMode !== 'compatible') return
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
  }, [moveSearch, viewMode])

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

  return (
    <div className="flex flex-col gap-3">
      <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        {document && (
          <span className="text-sm text-slate-500 dark:text-slate-400">총 {document.numPages}쪽</span>
        )}
        <span className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <button
            type="button"
            onClick={() => setViewMode('pdf')}
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
        {viewMode === 'compatible' && (
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
          </>
        )}
        {blobUrl && (
          <span className="ml-auto flex items-center gap-2">
            <a
              href={blobUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              원본 열기
            </a>
            <a
              href={blobUrl}
              download={`${title}.pdf`}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              내려받기
            </a>
          </span>
        )}
      </div>

      <div ref={column} className="flex flex-col gap-3">
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
        ) : viewMode === 'pdf' && blobUrl ? (
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
              searchQuery={searchQuery}
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
  )
}
