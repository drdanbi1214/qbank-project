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
          <Link to={`/study/${subject.id}`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">문제 학습</Link>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{error}</p>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">아직 등록된 이론이 없습니다.</p>
        </div>
      ) : usesSectionLanding && !activeSection ? (
        <TheorySectionLanding subjectId={subject.id} subjectName={subject.name} sections={sectionRoots} documents={documents} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setOutlineEditing((on) => !on)}
                className={cn(
                  'mb-1 w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  outlineEditing
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800',
                )}
              >
                {outlineEditing ? '목차 편집 끝내기' : '목차 편집'}
              </button>
            )}
            {navigationRoots.map((document) => <TheoryNavBranch key={document.id} document={document} subjectId={subject.id} selectedId={current?.id} childrenOf={childrenOf} expanded={visibleExpanded} onToggle={toggleExpanded} editing={outlineEditing} onShift={shift} onMove={setMoving} onRename={rename} />)}
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
                <RichTextViewer doc={selected.content} hierarchicalIndent />
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
}

function TheoryNavBranch({ document, subjectId, selectedId, childrenOf, expanded, onToggle, depth = 0, editing, onShift, onMove, onRename }: {
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
        </span>
      )}
    </div>
    {hasChildren && isExpanded && children.map((child) => <TheoryNavBranch key={child.id} document={child} subjectId={subjectId} selectedId={selectedId} childrenOf={childrenOf} expanded={expanded} onToggle={onToggle} depth={depth + 1} editing={editing} onShift={onShift} onMove={onMove} onRename={onRename} />)}
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
