import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import {
  createTheoryDocument,
  deleteTheoryDocument,
  fetchTheoryDocuments,
  renameTheoryDocument,
  swapTheoryOrder,
  updateTheoryDocumentContent,
  type TheoryDocument,
} from '@/lib/queries/theory'
import { MoveDialog } from '@/components/theory/TheoryOutlineTools'
import { uploadTheoryImage } from '@/lib/uploads'
import type { RichDoc } from '@/types/richtext'
import { cn } from '@/utils/cn'

export function TheorySubjectPage() {
  const { subjectId, documentId } = useParams()
  const { session, isAdmin } = useAuth()
  const { taxonomy, loading: taxonomyLoading } = useData()
  const embed = useEmbedPickers({ subjectId: subjectId, theory: true })
  const [documents, setDocuments] = useState<TheoryDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editedContent = useRef<RichDoc | null>(null)

  // 목차를 옮기고 나면 다시 읽어야 하므로 따로 뺀다.
  const load = useCallback(() => {
    if (!subjectId) return
    void fetchTheoryDocuments(subjectId)
      .then(setDocuments)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '이론을 불러오지 못했습니다.')
      })
  }, [subjectId])

  useEffect(load, [load])

  // 목차 편집 — 관리자만. 원본 폴더 구조를 그대로 가져온 목차라 손볼 일이 잦다.
  const [outlineEditing, setOutlineEditing] = useState(false)
  const [moving, setMoving] = useState<TheoryDocument | null>(null)

  const shift = useCallback(
    (document: TheoryDocument, direction: -1 | 1) => {
      const siblings = (documents ?? [])
        .filter((row) => row.parentId === document.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ko'))
      const index = siblings.findIndex((row) => row.id === document.id)
      const neighbour = siblings[index + direction]
      if (!neighbour) return
      void swapTheoryOrder(document, neighbour).then(load).catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '순서를 바꾸지 못했습니다.')
      })
    },
    [documents, load],
  )

  const rename = useCallback(
    async (document: TheoryDocument, title: string) => {
      try {
        await renameTheoryDocument(document.id, title)
        load()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '이름을 바꾸지 못했습니다.')
      }
    },
    [load],
  )

  const addChild = useCallback(
    async (parentId: string | null, hasContent: boolean) => {
      if (!subjectId || !session) return
      try {
        await createTheoryDocument({
          subjectId,
          parentId,
          title: hasContent ? '새 이론' : '새 묶음',
          hasContent,
          userId: session.user.id,
        })
        load()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '만들지 못했습니다.')
      }
    },
    [subjectId, session, load],
  )

  const removeDocument = useCallback(
    async (document: TheoryDocument) => {
      if (!window.confirm(`"${document.title}" 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return
      try {
        await deleteTheoryDocument(document.id)
        load()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '지우지 못했습니다.')
      }
    },
    [load],
  )


  if (!subjectId) return <Navigate to="/theory" replace />
  if (taxonomyLoading || documents === null) {
    return <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
  }

  const subject = taxonomy?.subjectById.get(subjectId)
  if (!subject) return <Navigate to="/theory" replace />
  const compareTheory = (a: TheoryDocument, b: TheoryDocument) => {
    const aNumber = leadingNumber(a.title)
    const bNumber = leadingNumber(b.title)
    if (aNumber !== null && bNumber !== null && aNumber !== bNumber) return aNumber - bNumber
    return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ko', { numeric: true })
  }
  const topLevel = documents.filter((document) => document.parentId === null).sort(compareTheory)
  const childrenOf = (parentId: string) => documents.filter((document) => document.parentId === parentId).sort(compareTheory)
  const current = documents.find((item) => item.id === documentId) ?? null
  const selected = current?.hasContent ? current : null
  const sectionRoots = topLevel.filter((document) => document.sourceKey?.startsWith('section:'))
  const usesSectionLanding = ['내과', '외과'].includes(subject.name) && sectionRoots.length > 0
  const activeSection = usesSectionLanding && current
    ? findSectionRoot(current, documents, new Set(sectionRoots.map((document) => document.id)))
    : null
  const navigationRoots = activeSection ? childrenOf(activeSection.id) : topLevel
  // 아래쪽 이전/다음은 목차에 보이는 차례 그대로 따라간다. 글이 없는 묶음은
  // 읽을 것이 없으므로 건너뛴다.
  const readingOrder: TheoryDocument[] = []
  const walk = (nodes: TheoryDocument[]) => {
    for (const node of nodes) {
      if (node.hasContent) readingOrder.push(node)
      walk(childrenOf(node.id))
    }
  }
  walk(topLevel)
  const visibleExpanded = new Set(expanded)
  const documentById = new Map(documents.map((document) => [document.id, document]))
  let selectedParentId = current?.parentId
  while (selectedParentId) {
    visibleExpanded.add(selectedParentId)
    selectedParentId = documentById.get(selectedParentId)?.parentId ?? null
  }
  if (current && !current.hasContent) visibleExpanded.add(current.id)
  function toggleExpanded(id: string) {
    setExpanded((currentSet) => {
      const next = new Set(currentSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  async function saveTheory(document: TheoryDocument) {
    if (!editedContent.current) return
    setEditBusy(true)
    setEditError(null)
    try {
      const content = editedContent.current
      const updatedAt = await updateTheoryDocumentContent(document.id, content)
      setDocuments((currentDocuments) => currentDocuments?.map((item) => (
        item.id === document.id ? { ...item, content, updatedAt } : item
      )) ?? null)
      setEditingId(null)
      editedContent.current = null
    } catch (caught) {
      setEditError(caught instanceof Error ? caught.message : '이론을 저장하지 못했습니다.')
    } finally {
      setEditBusy(false)
    }
  }

  return (
    <section>
      <header className="mb-4">
        <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          <Link to="/theory" className="hover:underline">이론 보기</Link>
          {activeSection && <><span>/</span><Link to={`/theory/${subject.id}`} className="hover:underline">{subject.name}</Link></>}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{activeSection?.title ?? `${subject.name} 이론`}</h1>
          <div className="flex shrink-0 items-center gap-3">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setOutlineEditing((on) => !on)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors',
                  outlineEditing
                    ? 'bg-brand-600 text-white'
                    : 'border border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {outlineEditing ? '목차 편집 끝내기' : '목차 편집'}
              </button>
            )}
            <Link to={`/study/${subject.id}`} className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">문제 학습</Link>
          </div>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{error}</p>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">아직 등록된 이론이 없습니다.</p>
        </div>
      ) : usesSectionLanding && !activeSection && !outlineEditing ? (
        <TheorySectionLanding subjectId={subject.id} subjectName={subject.name} sections={sectionRoots} documents={documents} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
            {outlineEditing && (
              <div className="mb-1 flex gap-1 border-b border-slate-200 pb-1 dark:border-slate-700">
                <button type="button" onClick={() => void addChild(activeSection?.id ?? null, false)}
                  className="flex-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">
                  + 묶음
                </button>
                <button type="button" onClick={() => void addChild(activeSection?.id ?? null, true)}
                  className="flex-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700">
                  + 이론
                </button>
              </div>
            )}
            {navigationRoots.map((document) => <TheoryNavBranch key={document.id} document={document} subjectId={subject.id} selectedId={current?.id} childrenOf={childrenOf} expanded={visibleExpanded} onToggle={toggleExpanded} editing={outlineEditing} onShift={shift} onMove={setMoving} onRename={rename} onAdd={addChild} onDelete={removeDocument} />)}
          </nav>

          {selected && (
            <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h2 className="text-2xl font-bold tracking-tight">{selected.title}</h2>
                {isAdmin && session && editingId !== selected.id && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      editedContent.current = selected.content
                      setEditError(null)
                      setEditingId(selected.id)
                    }}
                  >
                    수정
                  </Button>
                )}
              </div>
              {editingId === selected.id && session ? (
                <div className="space-y-3">
                  <LazyRichTextEditor
                    key={selected.id}
                    initialValue={selected.content}
                    onChange={(content) => { editedContent.current = content }}
                    userId={session.user.id}
                    uploadImageFile={uploadTheoryImage}
                    placeholder="이론 내용을 입력하세요. 이미지는 붙여넣거나 이미지 버튼으로 추가할 수 있습니다."
                    minHeight="30rem"
                    onUploadError={setEditError}
                    onRequestTheory={embed.onRequestTheory}
                  />
                  {embed.pickers}
                  {editError && <p className="text-sm text-rose-600 dark:text-rose-400">{editError}</p>}
                  <div className="flex gap-2">
                    <Button onClick={() => void saveTheory(selected)} disabled={editBusy}>
                      {editBusy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                      저장
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditingId(null)
                        setEditError(null)
                        editedContent.current = null
                      }}
                      disabled={editBusy}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <RichTextViewer doc={selected.content} hierarchicalIndent />
                  <TheoryPager
                    subjectId={subject.id}
                    current={selected}
                    ordered={readingOrder}
                    titleOf={(id) => documentById.get(id)?.title ?? ''}
                  />
                </>
              )}
            </article>
          )}
          {!selected && (
            current ? (
              <TheoryGroupLanding subjectId={subject.id} document={current} children={childrenOf(current.id)} />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">부속 이론 또는 단원을 선택하세요.</p>
              </div>
            )
          )}
        </div>
      )}

      {moving && documents && (
        <MoveDialog
          document={moving}
          all={documents}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null)
            load()
          }}
        />
      )}
    </section>
  )
}

function leadingNumber(title: string): number | null {
  const match = title.match(/^\s*(\d+)/)
  return match ? Number(match[1]) : null
}

function findSectionRoot(document: TheoryDocument, documents: TheoryDocument[], sectionIds: Set<string>): TheoryDocument | null {
  const byId = new Map(documents.map((item) => [item.id, item]))
  let candidate: TheoryDocument | undefined = document
  const visited = new Set<string>()
  while (candidate && !visited.has(candidate.id)) {
    if (sectionIds.has(candidate.id)) return candidate
    visited.add(candidate.id)
    candidate = candidate.parentId ? byId.get(candidate.parentId) : undefined
  }
  return null
}

function TheorySectionLanding({ subjectId, subjectName, sections, documents }: {
  subjectId: string
  subjectName: string
  sections: TheoryDocument[]
  documents: TheoryDocument[]
}) {
  const contentCounts = useMemo(() => {
    const children = new Map<string, TheoryDocument[]>()
    for (const document of documents) {
      if (!document.parentId) continue
      children.set(document.parentId, [...(children.get(document.parentId) ?? []), document])
    }
    const countContents = (id: string): number => (children.get(id) ?? []).reduce(
      (count, document) => count + (document.hasContent ? 1 : 0) + countContents(document.id),
      0,
    )
    return new Map(sections.map((section) => [section.id, countContents(section.id)]))
  }, [documents, sections])

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">확인할 {subjectName} 이론을 선택하세요.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <li key={section.id}>
            <Link
              to={`/theory/${subjectId}/${section.id}`}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
                <Icon name="theory" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{section.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">이론 {contentCounts.get(section.id) ?? 0}개</span>
              </span>
              <Icon name="chevron-right" size={18} className="text-slate-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TheoryGroupLanding({ subjectId, document, children }: {
  subjectId: string
  document: TheoryDocument
  children: TheoryDocument[]
}) {
  return (
    <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <h2 className="text-2xl font-bold tracking-tight">{document.title}</h2>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">아래 소주제에서 필요한 이론을 선택하세요.</p>
      {children.length > 0 ? (
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                to={`/theory/${subjectId}/${child.id}`}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 transition-colors hover:border-brand-400 hover:bg-brand-50/40 dark:border-slate-700 dark:hover:bg-brand-900/20"
              >
                <Icon name="theory" size={18} className="shrink-0 text-brand-600 dark:text-brand-300" />
                <span className="min-w-0 flex-1 truncate font-medium">{child.title}</span>
                <Icon name="chevron-right" size={17} className="shrink-0 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">등록된 소주제가 없습니다.</p>
      )}
    </article>
  )
}

type OutlineTools = {
  /** 목차 편집 중인지. 관리자가 켰을 때만 참이다. */
  editing?: boolean
  onShift?: (document: TheoryDocument, direction: -1 | 1) => void
  onMove?: (document: TheoryDocument) => void
  onRename?: (document: TheoryDocument, title: string) => Promise<void>
  onAdd?: (parentId: string, hasContent: boolean) => Promise<void>
  onDelete?: (document: TheoryDocument) => Promise<void>
}

function TheoryNavBranch({ document, subjectId, selectedId, childrenOf, expanded, onToggle, depth = 0, editing, onShift, onMove, onRename, onAdd, onDelete }: {
  document: TheoryDocument; subjectId: string; selectedId?: string; childrenOf: (id: string) => TheoryDocument[]; expanded: Set<string>; onToggle: (id: string) => void; depth?: number
} & OutlineTools) {
  const children = childrenOf(document.id)
  const hasChildren = children.length > 0
  // 편집 중에는 옮길 곳이 보여야 하므로 접힌 가지도 펼쳐 둔다.
  const isExpanded = expanded.has(document.id) || Boolean(editing)
  const [draft, setDraft] = useState<string | null>(null)

  async function commit() {
    if (draft === null) return
    const next = draft
    setDraft(null)
    if (next.trim() !== '' && next !== document.title) await onRename?.(document, next)
  }

  return <div>
    <div className="flex items-center gap-0.5">
      <div className="min-w-0 flex-1">
        {draft !== null ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit()
              if (event.key === 'Escape') setDraft(null)
            }}
            className={cn(
              'w-full rounded-lg border border-brand-500 px-2 py-1.5 text-sm dark:bg-slate-800',
              depth > 0 && 'ml-3',
            )}
          />
        ) : (
          <TheoryNavItem document={document} subjectId={subjectId} selectedId={selectedId} group={hasChildren} depth={depth} expanded={isExpanded} onToggle={hasChildren && !editing ? () => onToggle(document.id) : undefined} />
        )}
      </div>
      {editing && draft === null && (
        <span className="flex shrink-0 items-center">
          <OutlineButton label="이름 바꾸기" onClick={() => setDraft(document.title)}>✎</OutlineButton>
          <OutlineButton label="위로" onClick={() => onShift?.(document, -1)}>↑</OutlineButton>
          <OutlineButton label="아래로" onClick={() => onShift?.(document, 1)}>↓</OutlineButton>
          <OutlineButton label="다른 곳으로 옮기기" onClick={() => onMove?.(document)}>⇥</OutlineButton>
          <OutlineButton label="이 아래에 이론 추가" onClick={() => void onAdd?.(document.id, true)}>＋</OutlineButton>
          <OutlineButton label="지우기" onClick={() => void onDelete?.(document)}>✕</OutlineButton>
        </span>
      )}
    </div>
    {hasChildren && isExpanded && children.map((child) => <TheoryNavBranch key={child.id} document={child} subjectId={subjectId} selectedId={selectedId} childrenOf={childrenOf} expanded={expanded} onToggle={onToggle} depth={depth + 1} editing={editing} onShift={onShift} onMove={onMove} onRename={onRename} onAdd={onAdd} onDelete={onDelete} />)}
  </div>
}

function OutlineButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="rounded px-1 py-0.5 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {children}
    </button>
  )
}

function TheoryNavItem({
  document,
  subjectId,
  selectedId,
  group = false,
  depth = 0,
  expanded = false,
  onToggle,
}: {
  document: TheoryDocument
  subjectId: string
  selectedId?: string
  group?: boolean
  depth?: number
  expanded?: boolean
  onToggle?: () => void
}) {
  const label = <span className={cn('min-w-0 truncate', group && 'font-semibold')}>{document.title}</span>
  const className = cn(
    'flex min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
    depth > 0 && 'ml-3',
    selectedId === document.id
      ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
      : document.hasContent ? 'hover:bg-slate-50 dark:hover:bg-slate-800' : 'text-slate-700 dark:text-slate-200',
  )

  if (!document.hasContent) return (
    <div className={className}>
      {group ? <Link to={`/theory/${subjectId}/${document.id}`} className="min-w-0 flex-1 truncate">{label}</Link> : label}
      {onToggle && <button type="button" onClick={onToggle} aria-label={`${document.title} ${expanded ? '접기' : '펼치기'}`} className="px-1 text-slate-400">{expanded ? '⌄' : '›'}</button>}
    </div>
  )

  return (
    <div className={className}>
      <Link to={`/theory/${subjectId}/${document.id}`} className="min-w-0 flex-1 truncate">
      {label}
      </Link>
      {onToggle && <button type="button" onClick={onToggle} aria-label={`${document.title} ${expanded ? '접기' : '펼치기'}`} className="px-1 text-slate-400">{expanded ? '⌄' : '›'}</button>}
      <span className="shrink-0 rounded border border-brand-200 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:border-brand-800 dark:text-brand-200">
        이론
      </span>
    </div>
  )
}

/**
 * 글 아래쪽 이전/다음 이동.
 *
 * 목차에 보이는 차례를 그대로 따라가므로 묶음 경계를 넘어 다음 대단원으로도
 * 이어진다. 양 끝에서는 링크 대신 왜 더 갈 곳이 없는지 알려준다 — 눌리지
 * 않는 화살표만 있으면 고장인지 끝인지 구분되지 않는다.
 */
function TheoryPager({ subjectId, current, ordered, titleOf }: {
  subjectId: string
  current: TheoryDocument
  ordered: TheoryDocument[]
  titleOf: (id: string) => string
}) {
  const index = ordered.findIndex((row) => row.id === current.id)
  if (index === -1) return null
  const previous = index > 0 ? ordered[index - 1] : null
  const next = index < ordered.length - 1 ? ordered[index + 1] : null

  return (
    <nav className="mt-10 flex items-stretch justify-between gap-3 border-t border-slate-200 pt-5 dark:border-slate-700">
      {previous ? (
        <Link
          to={`/theory/${subjectId}/${previous.id}`}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-400 transition-colors group-hover:border-brand-500 group-hover:text-brand-600 dark:border-slate-600">
            ‹
          </span>
          <span className="min-w-0">
            {previous.parentId && (
              <span className="block truncate text-xs text-slate-400 dark:text-slate-500">
                {titleOf(previous.parentId)}
              </span>
            )}
            <span className="block truncate text-sm font-semibold">{previous.title}</span>
          </span>
        </Link>
      ) : (
        <span className="flex flex-1 items-center px-4 text-xs text-slate-400 dark:text-slate-500">
          첫 단원입니다
        </span>
      )}

      {next ? (
        <Link
          to={`/theory/${subjectId}/${next.id}`}
          className="group flex min-w-0 flex-1 items-center justify-end gap-3 rounded-xl px-2 py-2 text-right transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <span className="min-w-0">
            {next.parentId && (
              <span className="block truncate text-xs text-slate-400 dark:text-slate-500">
                {titleOf(next.parentId)}
              </span>
            )}
            <span className="block truncate text-sm font-semibold">{next.title}</span>
          </span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-400 transition-colors group-hover:border-brand-500 group-hover:text-brand-600 dark:border-slate-600">
            ›
          </span>
        </Link>
      ) : (
        <span className="flex flex-1 items-center justify-end px-4 text-xs text-slate-400 dark:text-slate-500">
          마지막 단원입니다
        </span>
      )}
    </nav>
  )
}
