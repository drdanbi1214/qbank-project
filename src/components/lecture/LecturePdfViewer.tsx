import { useEffect, useMemo, useRef, useState } from 'react'
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

type Props = { storagePath: string; title: string }

/** 한 쪽. 화면 가까이 왔을 때만 캔버스에 그린다. */
function PdfPage({
  document,
  pageNumber,
  width,
}: {
  document: PDFDocumentProxy
  pageNumber: number
  width: number
}) {
  const holder = useRef<HTMLDivElement | null>(null)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [ratio, setRatio] = useState(1.414) // A4 세로 비율. 실제 크기를 알기 전 자리만 잡는다.

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

    void (async () => {
      const page = await document.getPage(pageNumber)
      if (cancelled) return

      const base = page.getViewport({ scale: 1 })
      if (!cancelled) setRatio(base.height / base.width)

      // 고해상도 화면에서 글자가 뭉개지지 않도록 실제 픽셀만큼 그린다. 3배를
      // 넘기면 145쪽짜리에서 메모리가 급격히 늘어 상한을 둔다.
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      const target = canvas.current
      const context = target?.getContext('2d')
      if (!target || !context || cancelled) return

      target.width = Math.floor(viewport.width)
      target.height = Math.floor(viewport.height)
      target.style.width = '100%'
      target.style.height = 'auto'

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
    }
  }, [visible, width, document, pageNumber])

  return (
    <div
      ref={holder}
      data-page={pageNumber}
      className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700"
      style={{ aspectRatio: visible ? undefined : `1 / ${ratio}` }}
    >
      <canvas ref={canvas} className="block w-full" />
      <span className="absolute bottom-1 right-2 rounded bg-slate-900/60 px-1.5 text-[11px] text-white">
        {pageNumber}
      </span>
    </div>
  )
}

export function LecturePdfViewer({ storagePath, title }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const column = useRef<HTMLDivElement | null>(null)

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {document && (
          <span className="text-sm text-slate-500 dark:text-slate-400">총 {document.numPages}쪽</span>
        )}
        {blobUrl && (
          <a
            href={blobUrl}
            download={`${title}.pdf`}
            className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            내려받기
          </a>
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
        ) : (
          pages.map((pageNumber) => (
            <PdfPage key={pageNumber} document={document} pageNumber={pageNumber} width={width} />
          ))
        )}
      </div>
    </div>
  )
}
