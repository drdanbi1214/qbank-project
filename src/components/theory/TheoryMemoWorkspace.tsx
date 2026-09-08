import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { MarkableRegion } from '@/components/marking/MarkableRegion'
import type { RenderMark, SelectionRange } from '@/components/marking/marks'
import { useTextMarks } from '@/components/marking/useTextMarks'
import { useAuth } from '@/lib/auth'
import type { MarkTargetType } from '@/lib/queries/marks'
import {
  createTopicMemo,
  deleteTopicMemo,
  fetchTopicMemos,
  updateTopicMemo,
  updateTopicMemoColor,
} from '@/lib/queries/topicMemos'
import {
  createTheoryMemo,
  deleteTheoryMemo,
  fetchTheoryMemos,
  THEORY_MEMO_COLORS,
  updateTheoryMemo,
  updateTheoryMemoColor,
  type PersonalMemo,
  type TheoryMemoColor,
} from '@/lib/queries/theoryMemos'
import type { TheoryDocument } from '@/lib/queries/theory'
import { richTextToPlain, type RichDoc } from '@/types/richtext'
import { cn } from '@/utils/cn'

type Props = {
  document: TheoryDocument
  footer: ReactNode
}

type TopicProps = {
  topicId: string
  content: RichDoc
  footer: ReactNode
}

type MemoStore = {
  markTargetType: MarkTargetType
  fetch: (targetId: string) => Promise<PersonalMemo[]>
  create: (params: {
    userId: string
    targetId: string
    from: number
    to: number
    selectedText: string
  }) => Promise<PersonalMemo>
  updateContent: (id: string, content: RichDoc) => Promise<void>
  updateColor: (id: string, color: TheoryMemoColor) => Promise<void>
  delete: (id: string) => Promise<void>
}

type Point = { id: string; x1: number; y1: number; x2: number; y2: number }

const MEMO_COLOR_STYLES: Record<TheoryMemoColor, {
  label: string
  swatch: string
  card: string
  active: string
  header: string
  mutedText: string
  action: string
  collapsed: string
}> = {
  yellow: {
    label: '노랑',
    swatch: 'bg-[#fff1a8]',
    card: 'border-amber-300/90 bg-[#fff8cf] dark:border-amber-600/70 dark:bg-amber-950',
    active: 'border-amber-400 ring-amber-300/70 dark:border-amber-500 dark:ring-amber-700',
    header: 'border-amber-300/60 dark:border-amber-700/70',
    mutedText: 'text-amber-900/55 dark:text-amber-100/55',
    action: 'text-amber-900/55 hover:bg-amber-200/80 hover:text-amber-950 dark:text-amber-100/60 dark:hover:bg-amber-800 dark:hover:text-amber-50',
    collapsed: 'text-amber-950/70 hover:bg-amber-100/60 dark:text-amber-50/70 dark:hover:bg-amber-900/50',
  },
  rose: {
    label: '분홍',
    swatch: 'bg-[#ffcdd5]',
    card: 'border-rose-300/90 bg-[#fff0f2] dark:border-rose-700/70 dark:bg-rose-950',
    active: 'border-rose-400 ring-rose-300/70 dark:border-rose-500 dark:ring-rose-700',
    header: 'border-rose-300/60 dark:border-rose-700/70',
    mutedText: 'text-rose-900/55 dark:text-rose-100/55',
    action: 'text-rose-900/55 hover:bg-rose-200/80 hover:text-rose-950 dark:text-rose-100/60 dark:hover:bg-rose-800 dark:hover:text-rose-50',
    collapsed: 'text-rose-950/70 hover:bg-rose-100/60 dark:text-rose-50/70 dark:hover:bg-rose-900/50',
  },
  green: {
    label: '초록',
    swatch: 'bg-[#bcebd1]',
    card: 'border-emerald-300/90 bg-[#eaf9ef] dark:border-emerald-700/70 dark:bg-emerald-950',
    active: 'border-emerald-400 ring-emerald-300/70 dark:border-emerald-500 dark:ring-emerald-700',
    header: 'border-emerald-300/60 dark:border-emerald-700/70',
    mutedText: 'text-emerald-900/55 dark:text-emerald-100/55',
    action: 'text-emerald-900/55 hover:bg-emerald-200/80 hover:text-emerald-950 dark:text-emerald-100/60 dark:hover:bg-emerald-800 dark:hover:text-emerald-50',
    collapsed: 'text-emerald-950/70 hover:bg-emerald-100/60 dark:text-emerald-50/70 dark:hover:bg-emerald-900/50',
  },
  blue: {
    label: '파랑',
    swatch: 'bg-[#bfdefa]',
    card: 'border-sky-300/90 bg-[#edf7ff] dark:border-sky-700/70 dark:bg-sky-950',
    active: 'border-sky-400 ring-sky-300/70 dark:border-sky-500 dark:ring-sky-700',
    header: 'border-sky-300/60 dark:border-sky-700/70',
    mutedText: 'text-sky-900/55 dark:text-sky-100/55',
    action: 'text-sky-900/55 hover:bg-sky-200/80 hover:text-sky-950 dark:text-sky-100/60 dark:hover:bg-sky-800 dark:hover:text-sky-50',
    collapsed: 'text-sky-950/70 hover:bg-sky-100/60 dark:text-sky-50/70 dark:hover:bg-sky-900/50',
  },
  violet: {
    label: '보라',
    swatch: 'bg-[#ddcff8]',
    card: 'border-violet-300/90 bg-[#f6f0ff] dark:border-violet-700/70 dark:bg-violet-950',
    active: 'border-violet-400 ring-violet-300/70 dark:border-violet-500 dark:ring-violet-700',
    header: 'border-violet-300/60 dark:border-violet-700/70',
    mutedText: 'text-violet-900/55 dark:text-violet-100/55',
    action: 'text-violet-900/55 hover:bg-violet-200/80 hover:text-violet-950 dark:text-violet-100/60 dark:hover:bg-violet-800 dark:hover:text-violet-50',
    collapsed: 'text-violet-950/70 hover:bg-violet-100/60 dark:text-violet-50/70 dark:hover:bg-violet-900/50',
  },
}

const THEORY_MEMO_STORE: MemoStore = {
  markTargetType: 'theory',
  fetch: fetchTheoryMemos,
  create: ({ targetId, ...params }) => createTheoryMemo({ ...params, documentId: targetId }),
  updateContent: updateTheoryMemo,
  updateColor: updateTheoryMemoColor,
  delete: deleteTheoryMemo,
}

const TOPIC_MEMO_STORE: MemoStore = {
  markTargetType: 'topic',
  fetch: fetchTopicMemos,
  create: ({ targetId, ...params }) => createTopicMemo({ ...params, topicId: targetId }),
  updateContent: updateTopicMemo,
  updateColor: updateTopicMemoColor,
  delete: deleteTopicMemo,
}

/** 알렌 본문의 개인 표시와 여백 메모를 한 좌표계에서 그린다. */
export function TheoryMemoWorkspace({ document, footer }: Props) {
  return (
    <PersonalMemoWorkspace
      targetId={document.id}
      content={document.content}
      footer={footer}
      store={THEORY_MEMO_STORE}
      hierarchicalIndent
    />
  )
}

/** 레옵스 본문의 메모도 알렌과 같은 UI를 쓰되 별도 개인 저장소에 저장한다. */
export function TopicMemoWorkspace({ topicId, content, footer }: TopicProps) {
  return (
    <PersonalMemoWorkspace
      targetId={topicId}
      content={content}
      footer={footer}
      store={TOPIC_MEMO_STORE}
    />
  )
}

function PersonalMemoWorkspace({
  targetId,
  content,
  footer,
  store,
  hierarchicalIndent = false,
}: {
  targetId: string
  content: RichDoc
  footer: ReactNode
  store: MemoStore
  hierarchicalIndent?: boolean
}) {
  const { session } = useAuth()
  const textMarks = useTextMarks(store.markTargetType, targetId)
  const [memos, setMemos] = useState<PersonalMemo[]>([])
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
    void store.fetch(targetId)
      .then((rows) => {
        if (active) setMemos(rows)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '메모를 불러오지 못했습니다.')
      })
    return () => { active = false }
  }, [store, targetId])

  const sortedMemos = useMemo(
    () => [...memos].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id)),
    [memos],
  )
  const memoMarks = useMemo<RenderMark[]>(
    () => sortedMemos.map((memo) => ({ id: memo.id, from: memo.from, to: memo.to, style: 'comment' })),
    [sortedMemos],
  )

  const findAnchor = useCallback((memo: PersonalMemo): HTMLElement | null => {
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
      const memo = await store.create({
        userId: session.user.id,
        targetId,
        from: range.from,
        to: range.to,
        selectedText: range.text,
      })
      // 새 카드가 처음 렌더되고 편집기에 포커스될 때 브라우저가 절대 위치의
      // 카드로 스크롤하지 않도록, 렌더 직전 위치도 한 번 보존한다.
      const left = window.scrollX
      const top = window.scrollY
      setMemos((current) => [...current, memo])
      setActiveMemoId(memo.id)
      setFocusMemoId(memo.id)
      window.requestAnimationFrame(() => window.scrollTo(left, top))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모를 만들지 못했습니다.')
    }
  }, [session, store, targetId])

  const saveContent = useCallback(async (id: string, content: RichDoc) => {
    try {
      await store.updateContent(id, content)
      setMemos((current) => current.map((memo) => memo.id === id ? { ...memo, content } : memo))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모를 저장하지 못했습니다.')
      throw caught
    }
  }, [store])

  const saveColor = useCallback(async (id: string, color: TheoryMemoColor) => {
    try {
      await store.updateColor(id, color)
      setMemos((current) => current.map((memo) => memo.id === id ? { ...memo, color } : memo))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모지 색을 저장하지 못했습니다.')
      throw caught
    }
  }, [store])

  const removeMemo = useCallback(async (memo: PersonalMemo) => {
    if (!window.confirm('이 메모를 삭제할까요?')) return
    try {
      await store.delete(memo.id)
      setMemos((current) => current.filter((item) => item.id !== memo.id))
      if (activeMemoId === memo.id) setActiveMemoId(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '메모를 삭제하지 못했습니다.')
    }
  }, [activeMemoId, store])

  const focusMemo = useCallback((id: string) => {
    if (!memos.some((memo) => memo.id === id)) return
    setActiveMemoId(id)
    cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [memos])

  return (
    // Grid의 기본 stretch 상태에서 오른쪽 레일 안에 측정 높이만큼 spacer를 두면
    // 왼쪽 본문도 늘어나고 다음 ResizeObserver 측정이 그 값을 다시 더해 무한히
    // 길어진다. 두 열은 intrinsic 높이를 유지하고 레일 자체에만 최소 높이를 준다.
    <div ref={workspaceRef} className="relative grid min-w-0 items-start xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div ref={contentRef} className="min-w-0 px-4 pb-4 sm:px-5 sm:pb-5">
        <MarkableRegion
          regionRef={regionRef}
          onApply={textMarks.apply}
          onErase={textMarks.erase}
          onMemo={(range) => void addMemo(range)}
        >
          <RichTextViewer
            doc={content}
            hierarchicalIndent={hierarchicalIndent}
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
        style={desktop ? { minHeight: railHeight } : undefined}
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
              userId={session?.user.id ?? ''}
              onSaveContent={(content) => saveContent(memo.id, content)}
              onSaveColor={(color) => saveColor(memo.id, color)}
              onUploadError={setError}
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
  userId,
  onSaveContent,
  onSaveColor,
  onUploadError,
  onDelete,
}: {
  memo: PersonalMemo
  active: boolean
  autoFocus: boolean
  style?: CSSProperties
  className?: string
  cardRef: (node: HTMLDivElement | null) => void
  onFocus: () => void
  userId: string
  onSaveContent: (content: RichDoc) => Promise<void>
  onSaveColor: (color: TheoryMemoColor) => Promise<void>
  onUploadError: (message: string | null) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(memo.content)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pendingUploads, setPendingUploads] = useState(0)
  const [editing, setEditing] = useState(autoFocus)
  const [collapsed, setCollapsed] = useState(false)
  const [color, setColor] = useState(memo.color)
  const [savingColor, setSavingColor] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoFocus || !editing || !rootRef.current) return
    const root = rootRef.current
    let frame = 0
    let timeout = 0
    const focusWithoutJump = () => {
      const editor = root.querySelector<HTMLElement>('.ProseMirror')
      if (!editor) return false
      const left = window.scrollX
      const top = window.scrollY
      editor.focus({ preventScroll: true })
      // 일부 Safari는 preventScroll을 무시하므로 같은 프레임에 원위치를 복원한다.
      window.scrollTo(left, top)
      frame = window.requestAnimationFrame(() => window.scrollTo(left, top))
      return true
    }
    if (focusWithoutJump()) return () => window.cancelAnimationFrame(frame)

    // 편집기 청크가 지연 로딩된 경우 DOM이 생긴 순간 한 번만 포커스한다.
    const observer = new MutationObserver(() => {
      if (focusWithoutJump()) observer.disconnect()
    })
    observer.observe(root, { childList: true, subtree: true })
    timeout = window.setTimeout(() => observer.disconnect(), 5_000)
    return () => {
      observer.disconnect()
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(frame)
    }
  }, [autoFocus, editing])

  async function save(closeEditor = true): Promise<boolean> {
    if (pendingUploads > 0) {
      onUploadError('사진 업로드가 끝난 뒤 저장해 주세요.')
      return false
    }
    if (!dirty) {
      if (closeEditor) setEditing(false)
      return true
    }
    setSaving(true)
    try {
      await onSaveContent(draft)
      setDirty(false)
      if (closeEditor) setEditing(false)
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }

  async function collapse() {
    if (editing && !(await save())) return
    setCollapsed(true)
  }

  async function chooseColor(nextColor: TheoryMemoColor) {
    if (nextColor === color || savingColor) return
    const previousColor = color
    setColor(nextColor)
    setSavingColor(true)
    try {
      await onSaveColor(nextColor)
    } catch {
      setColor(previousColor)
    } finally {
      setSavingColor(false)
    }
  }

  const preview = richTextToPlain(memo.content) || memo.selectedText || '빈 메모'
  const colorStyle = MEMO_COLOR_STYLES[color]

  return (
    <div
      ref={(node) => {
        rootRef.current = node
        cardRef(node)
      }}
      style={style}
      onFocusCapture={onFocus}
      onClick={onFocus}
      className={cn(
        'group z-20 overflow-hidden rounded-[5px] border shadow-sm transition-[box-shadow,border-color,background-color]',
        colorStyle.card,
        active && cn('shadow-md ring-1', colorStyle.active),
        className,
      )}
    >
      <div className={cn('flex h-7 items-center gap-1 border-b px-1.5', colorStyle.header)}>
        <span className={cn('min-w-0 flex-1 truncate px-0.5 text-[10px]', colorStyle.mutedText)}>
          {memo.selectedText || '내 메모'}
        </span>
        {editing && (
          <div role="group" aria-label="메모지 색상" className="flex shrink-0 items-center gap-0.5">
            {THEORY_MEMO_COLORS.map((option) => {
              const optionStyle = MEMO_COLOR_STYLES[option]
              return (
                <button
                  key={option}
                  type="button"
                  aria-label={`${optionStyle.label} 메모지`}
                  title={`${optionStyle.label} 메모지`}
                  aria-pressed={color === option}
                  disabled={savingColor}
                  onClick={(event) => {
                    event.stopPropagation()
                    void chooseColor(option)
                  }}
                  className={cn(
                    'h-3.5 w-3.5 rounded-full border border-black/15 transition-transform hover:scale-110 disabled:opacity-50',
                    optionStyle.swatch,
                    color === option && 'ring-1 ring-slate-700 ring-offset-1 dark:ring-slate-100 dark:ring-offset-slate-900',
                  )}
                />
              )
            })}
          </div>
        )}
        {/* 접었을 때는 다시 키우는 □ 와 삭제 × 만 남긴다. */}
        {!collapsed && (editing ? (
          <MemoAction
            label={pendingUploads > 0 ? '사진 업로드 중' : saving ? '저장 중' : dirty ? '메모 저장' : '편집 끝내기'}
            disabled={saving || pendingUploads > 0}
            onClick={() => void save()}
            className={colorStyle.action}
          >
            <SaveIcon />
          </MemoAction>
        ) : (
          <MemoAction
            label="메모 편집"
            className={colorStyle.action}
            onClick={() => {
              setCollapsed(false)
              setEditing(true)
            }}
          >
            <PencilIcon />
          </MemoAction>
        ))}
        <MemoAction
          className={colorStyle.action}
          label={collapsed ? '메모 펼치기' : '메모 접기'}
          disabled={saving || pendingUploads > 0}
          onClick={() => {
            if (collapsed) setCollapsed(false)
            else void collapse()
          }}
        >
          {collapsed ? <ExpandIcon /> : <span aria-hidden="true" className="-mt-1 text-base">_</span>}
        </MemoAction>
        <MemoAction className={colorStyle.action} label="메모 삭제" disabled={saving || pendingUploads > 0} onClick={onDelete}>
          <span aria-hidden="true" className="text-base">×</span>
        </MemoAction>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className={cn('block w-full truncate px-2 py-1.5 text-left text-xs', colorStyle.collapsed)}
          aria-label="메모 펼치기"
          title="눌러서 메모 펼치기"
        >
          {preview}
        </button>
      ) : editing ? (
        <LazyRichTextEditor
          key={`${memo.id}:editor`}
          initialValue={draft}
          onChange={(content) => {
            setDraft(content)
            setDirty(true)
          }}
          userId={userId}
          compact
          memo
          placeholder="메모를 입력하세요"
          onUploadError={onUploadError}
          onPendingUploadsChange={setPendingUploads}
          maxImages={12}
          className="!rounded-none !border-0 !bg-transparent"
          contentClassName="memo-rich-text"
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setEditing(true)
          }}
          className="block min-h-14 w-full px-2 py-2 text-left"
          aria-label="메모 내용. 두 번 눌러 편집"
        >
          <RichTextViewer doc={memo.content} className="memo-rich-text" />
        </div>
      )}
    </div>
  )
}

function MemoAction({ label, disabled = false, onClick, children, className }: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn('grid h-5 w-5 shrink-0 place-items-center rounded disabled:opacity-35', className)}
    >
      {children}
    </button>
  )
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 4h12l2 2v14H5V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 4v6h8V4M8 20v-6h8v6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="m5 19 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L9 18l-4 1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m14.5 6.5 3 3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
