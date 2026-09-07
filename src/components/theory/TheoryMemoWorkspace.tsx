import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type ReactNode,
} from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { MarkableRegion } from '@/components/marking/MarkableRegion'
import type { RenderMark, SelectionRange } from '@/components/marking/marks'
import { useTextMarks } from '@/components/marking/useTextMarks'
import { ImageZoomModal } from '@/components/question/ImageZoomModal'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  createTheoryMemo,
  deleteTheoryMemo,
  fetchTheoryMemos,
  updateTheoryMemo,
  type TheoryMemo,
} from '@/lib/queries/theoryMemos'
import type { TheoryDocument } from '@/lib/queries/theory'
import { useSignedUrl } from '@/lib/storage'
import { clipboardHasImage, imageFilesFromClipboard, uploadImage } from '@/lib/uploads'
import { cn } from '@/utils/cn'

type Props = {
  document: TheoryDocument
  footer: ReactNode
}

type Point = { id: string; x1: number; y1: number; x2: number; y2: number }

/** 알렌 본문의 개인 표시와 여백 메모를 한 좌표계에서 그린다. */
export function TheoryMemoWorkspace({ document, footer }: Props) {
  const { session } = useAuth()
  const textMarks = useTextMarks('theory', document.id)
  const [memos, setMemos] = useState<TheoryMemo[]>([])
  const [activeMemoId, setActiveMemoId] = useState<string | null>(null)
  const [focusMemoId, setFocusMemoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, number>>({})
  const [connectors, setConnectors] = useState<Point[]>([])
  const [railHeight, setRailHeight] = useState(0)
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1280px)').matches)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const regionRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLElement>(null)
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)')
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    let active = true
    void fetchTheoryMemos(document.id)
      .then((rows) => {
        if (active) setMemos(rows)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '메모를 불러오지 못했습니다.')
      })
    return () => { active = false }
  }, [document.id])

  const sortedMemos = useMemo(
    () => [...memos].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id)),
    [memos],
  )
  const memoMarks = useMemo<RenderMark[]>(
    () => sortedMemos.map((memo) => ({ id: memo.id, from: memo.from, to: memo.to, style: 'comment' })),
    [sortedMemos],
  )

  const findAnchor = useCallback((memo: TheoryMemo): HTMLElement | null => {
    const region = regionRef.current
    if (!region) return null
    const exact = region.querySelector<HTMLElement>(`[data-pos="${memo.from}"]`)
    if (exact) return exact
    let closest: HTMLElement | null = null
    let closestPosition = -1
    for (const element of region.querySelectorAll<HTMLElement>('[data-pos]')) {
      const position = Number(element.dataset.pos)
      if (position <= memo.from && position > closestPosition) {
        closest = element
        closestPosition = position
      }
    }
    return closest
  }, [])

  const measurePositions = useCallback(() => {
    if (!desktop || !railRef.current || !contentRef.current) {
      setPositions({})
      setConnectors([])
      setRailHeight(0)
      return
    }
    const railRect = railRef.current.getBoundingClientRect()
    const next: Record<string, number> = {}
    let bottom = 44
    for (const memo of sortedMemos) {
      const anchor = findAnchor(memo)
      const wanted = anchor ? anchor.getBoundingClientRect().top - railRect.top - 8 : bottom
      const top = Math.max(44, wanted, bottom)
      next[memo.id] = top
      bottom = top + (cardRefs.current.get(memo.id)?.offsetHeight ?? 82) + 10
    }
    setPositions((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    setRailHeight(Math.max(contentRef.current.scrollHeight, bottom + 8))
  }, [desktop, findAnchor, sortedMemos])

  useLayoutEffect(measurePositions, [measurePositions])

  useEffect(() => {
    const observer = new ResizeObserver(measurePositions)
    if (contentRef.current) observer.observe(contentRef.current)
    for (const card of cardRefs.current.values()) observer.observe(card)
    window.addEventListener('resize', measurePositions)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measurePositions)
    }
  }, [measurePositions, sortedMemos.length])

  useLayoutEffect(() => {
    if (!desktop) return
    const frame = window.requestAnimationFrame(() => {
      const workspace = workspaceRef.current
      if (!workspace) return
      const workspaceRect = workspace.getBoundingClientRect()
      const next = sortedMemos.flatMap((memo): Point[] => {
        const anchor = findAnchor(memo)
        const card = cardRefs.current.get(memo.id)
        if (!anchor || !card) return []
        const anchorRect = anchor.getBoundingClientRect()
        const cardRect = card.getBoundingClientRect()
        return [{
          id: memo.id,
          x1: anchorRect.right - workspaceRect.left + 4,
          y1: anchorRect.top + anchorRect.height / 2 - workspaceRect.top,
          x2: cardRect.left - workspaceRect.left + 3,
          y2: cardRect.top + Math.min(24, cardRect.height / 2) - workspaceRect.top,
        }]
      })
      setConnectors(next)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [desktop, findAnchor, positions, sortedMemos])

  const addMemo = useCallback(async (range: SelectionRange) => {
    if (!session) return
    setError(null)
    try {
      const memo = await createTheoryMemo({
        userId: session.user.id,
        documentId: document.id,
        from: range.from,
        to: range.to,
        selectedText: range.text,
      })
      setMemos((current) => [...current, memo])
      setActiveMemoId(memo.id)
      setFocusMemoId(memo.id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모를 만들지 못했습니다.')
    }
  }, [document.id, session])

  const saveBody = useCallback(async (id: string, body: string) => {
    try {
      await updateTheoryMemo(id, { body })
      setMemos((current) => current.map((memo) => memo.id === id ? { ...memo, body } : memo))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모를 저장하지 못했습니다.')
    }
  }, [])

  const addImages = useCallback(async (memo: TheoryMemo, files: File[]) => {
    if (!session || files.length === 0) return
    setError(null)
    try {
      const added = await Promise.all(files.map((file) => uploadImage(file, session.user.id)))
      const imagePaths = [...memo.imagePaths, ...added].slice(0, 12)
      await updateTheoryMemo(memo.id, { imagePaths })
      setMemos((current) => current.map((item) => item.id === memo.id ? { ...item, imagePaths } : item))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사진을 넣지 못했습니다.')
    }
  }, [session])

  const removeImage = useCallback(async (memo: TheoryMemo, path: string) => {
    const imagePaths = memo.imagePaths.filter((item) => item !== path)
    try {
      await updateTheoryMemo(memo.id, { imagePaths })
      setMemos((current) => current.map((item) => item.id === memo.id ? { ...item, imagePaths } : item))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사진을 빼지 못했습니다.')
    }
  }, [])

  const removeMemo = useCallback(async (memo: TheoryMemo) => {
    if (!window.confirm('이 메모를 삭제할까요?')) return
    try {
      await deleteTheoryMemo(memo.id)
      setMemos((current) => current.filter((item) => item.id !== memo.id))
      if (activeMemoId === memo.id) setActiveMemoId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모를 삭제하지 못했습니다.')
    }
  }, [activeMemoId])

  const focusMemo = useCallback((id: string) => {
    if (!memos.some((memo) => memo.id === id)) return
    setActiveMemoId(id)
    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [memos])

  return (
    <div ref={workspaceRef} className="relative grid min-w-0 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div ref={contentRef} className="min-w-0 px-4 pb-4 sm:px-5 sm:pb-5">
        <MarkableRegion
          regionRef={regionRef}
          onApply={textMarks.apply}
          onErase={textMarks.erase}
          onMemo={(range) => void addMemo(range)}
        >
          <RichTextViewer
            doc={document.content}
            hierarchicalIndent
            marks={[...memoMarks, ...textMarks.marks]}
            onMarkClick={focusMemo}
            activeMarkId={activeMemoId}
          />
        </MarkableRegion>
        {footer}
      </div>

      <aside
        ref={railRef}
        aria-label="내 메모"
        className="relative border-t border-slate-200 bg-slate-50/70 px-2 pb-3 pt-2 dark:border-slate-700 dark:bg-slate-950/35 xl:border-l xl:border-t-0"
      >
        <div className="mb-2 flex h-8 items-center justify-between px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
          <span>내 메모</span>
          {memos.length > 0 && <span>{memos.length}</span>}
        </div>
        {error && (
          <p className="relative z-20 mb-2 rounded-md bg-rose-50 px-2 py-1.5 text-xs leading-tight text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
            {error}
          </p>
        )}
        {memos.length === 0 && (
          <p className="px-1 py-3 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
            본문을 드래그한 뒤 메모 버튼을 누르면 여기에 메모지가 생깁니다.
          </p>
        )}
        <div aria-hidden="true" style={desktop ? { height: railHeight } : undefined} />
        <div className={cn(!desktop && 'space-y-2')}>
          {sortedMemos.map((memo) => (
            <TheoryMemoCard
              key={memo.id}
              memo={memo}
              active={activeMemoId === memo.id}
              autoFocus={focusMemoId === memo.id}
              style={desktop ? { top: positions[memo.id] ?? 44 } : undefined}
              className={desktop ? 'absolute inset-x-2' : 'relative'}
              cardRef={(node) => {
                if (node) cardRefs.current.set(memo.id, node)
                else cardRefs.current.delete(memo.id)
              }}
              onFocus={() => {
                setActiveMemoId(memo.id)
                if (focusMemoId === memo.id) setFocusMemoId(null)
              }}
              onSaveBody={(body) => saveBody(memo.id, body)}
              onAddImages={(files) => addImages(memo, files)}
              onRemoveImage={(path) => removeImage(memo, path)}
              onDelete={() => void removeMemo(memo)}
            />
          ))}
        </div>
      </aside>

      {desktop && connectors.length > 0 && (
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible">
          {connectors.map((point) => {
            const bend = Math.max(24, Math.min(70, (point.x2 - point.x1) / 2))
            return (
              <g key={point.id}>
                <path
                  d={`M ${point.x1} ${point.y1} C ${point.x1 + bend} ${point.y1}, ${point.x2 - bend} ${point.y2}, ${point.x2} ${point.y2}`}
                  fill="none"
                  stroke="#f3b913"
                  strokeWidth="1.5"
                />
                <circle cx={point.x1} cy={point.y1} r="3" fill="#f3b913" />
                <circle cx={point.x2} cy={point.y2} r="3" fill="#f3b913" />
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

function TheoryMemoCard({
  memo,
  active,
  autoFocus,
  style,
  className,
  cardRef,
  onFocus,
  onSaveBody,
  onAddImages,
  onRemoveImage,
  onDelete,
}: {
  memo: TheoryMemo
  active: boolean
  autoFocus: boolean
  style?: CSSProperties
  className?: string
  cardRef: (node: HTMLDivElement | null) => void
  onFocus: () => void
  onSaveBody: (body: string) => Promise<void>
  onAddImages: (files: File[]) => Promise<void>
  onRemoveImage: (path: string) => Promise<void>
  onDelete: () => void
}) {
  const [body, setBody] = useState(memo.body)
  const [dirty, setDirty] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [zoomed, setZoomed] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.max(42, textarea.scrollHeight)}px`
  }, [body])

  useEffect(() => {
    if (!dirty) return
    const timer = window.setTimeout(() => {
      void onSaveBody(body).then(() => setDirty(false))
    }, 700)
    return () => window.clearTimeout(timer)
  }, [body, dirty, onSaveBody])

  async function upload(files: File[]) {
    if (files.length === 0) return
    setUploading(true)
    try {
      await onAddImages(files)
    } finally {
      setUploading(false)
    }
  }

  async function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (!clipboardHasImage(event.clipboardData)) return
    event.preventDefault()
    const files = await imageFilesFromClipboard(event.clipboardData)
    if (files.length === 0) return
    await upload(files)
  }

  return (
    <div
      ref={cardRef}
      style={style}
      onFocus={onFocus}
      onClick={onFocus}
      className={cn(
        'group z-20 overflow-hidden rounded-[5px] border border-amber-300/90 bg-[#fff8cf] p-2 shadow-sm transition-[box-shadow,border-color] dark:border-amber-600/70 dark:bg-amber-950',
        active && 'border-amber-400 shadow-md ring-1 ring-amber-300/70 dark:border-amber-500 dark:ring-amber-700',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-[-1px] top-[-1px] h-5 w-5 border-b border-l border-amber-300 bg-amber-100 dark:border-amber-600 dark:bg-amber-900"
        style={{ clipPath: 'polygon(0 0, 100% 100%, 0 100%)' }}
      />
      <button
        type="button"
        aria-label="메모 삭제"
        title="메모 삭제"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        className="absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded text-sm leading-none text-amber-900/40 opacity-0 transition-opacity hover:bg-amber-200/70 hover:text-amber-950 group-hover:opacity-100 focus:opacity-100 dark:text-amber-100/50 dark:hover:bg-amber-800"
      >
        ×
      </button>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
          setDirty(true)
        }}
        onPaste={(event) => void paste(event)}
        onBlur={() => {
          if (!dirty) return
          void onSaveBody(body).then(() => setDirty(false))
        }}
        placeholder="메모를 입력하세요"
        aria-label="메모 내용"
        className="block min-h-10 w-full resize-none overflow-hidden border-0 bg-transparent pr-4 text-[13px] font-medium leading-[1.28] text-slate-800 outline-none placeholder:text-amber-900/35 dark:text-amber-50 dark:placeholder:text-amber-200/40"
      />
      {memo.imagePaths.length > 0 && (
        <div className={cn('mt-1 grid gap-1', memo.imagePaths.length > 1 && 'grid-cols-2')}>
          {memo.imagePaths.map((path) => (
            <MemoImage key={path} path={path} onZoom={setZoomed} onRemove={() => void onRemoveImage(path)} />
          ))}
        </div>
      )}
      {uploading ? (
        <Spinner className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 border-amber-800/20 border-t-amber-700 dark:border-amber-200/20 dark:border-t-amber-200" />
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded text-amber-800/55 opacity-0 transition-opacity hover:bg-amber-200/70 hover:text-amber-900 group-hover:opacity-100 focus:opacity-100 dark:text-amber-200/60 dark:hover:bg-amber-800"
          aria-label="사진 추가"
          title="사진 추가 (붙여넣기도 가능)"
        >
          <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="8.5" cy="9" r="1.5" fill="currentColor" />
            <path d="m5 18 4.5-4.5 3 3 2.5-2.5 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          void upload(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      {zoomed && <ImageZoomModal src={zoomed} caption={null} onClose={() => setZoomed(null)} />}
    </div>
  )
}

function MemoImage({ path, onZoom, onRemove }: {
  path: string
  onZoom: (url: string) => void
  onRemove: () => void
}) {
  const src = useSignedUrl(path)
  if (!src) return <div className="h-16 animate-pulse rounded bg-amber-200/60 dark:bg-amber-900" />
  return (
    <div className="group/image relative min-w-0">
      <button type="button" onClick={() => onZoom(src)} className="block w-full cursor-zoom-in overflow-hidden rounded-sm">
        <img src={src} alt="메모 사진" className="max-h-44 w-full object-cover" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        aria-label="사진 빼기"
        title="사진 빼기"
        className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-slate-950/65 text-sm leading-none text-white opacity-0 group-hover/image:opacity-100 focus:opacity-100"
      >
        ×
      </button>
    </div>
  )
}
