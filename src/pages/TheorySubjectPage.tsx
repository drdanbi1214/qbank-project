import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import { cn } from '@/utils/cn'

export function TheorySubjectPage() {
  const { subjectId, documentId } = useParams()
  const { taxonomy, loading: taxonomyLoading } = useData()
  const [documents, setDocuments] = useState<TheoryDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (!subjectId) return
    let active = true
    void fetchTheoryDocuments(subjectId)
      .then((rows) => {
        if (active) setDocuments(rows)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '이론을 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [subjectId])

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
  let selectedParentId = selected?.parentId
  while (selectedParentId) {
    visibleExpanded.add(selectedParentId)
    selectedParentId = documentById.get(selectedParentId)?.parentId ?? null
  }
  function toggleExpanded(id: string) {
    setExpanded((currentSet) => {
      const next = new Set(currentSet)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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
            {navigationRoots.map((document) => <TheoryNavBranch key={document.id} document={document} subjectId={subject.id} selectedId={selected?.id} childrenOf={childrenOf} expanded={visibleExpanded} onToggle={toggleExpanded} />)}
          </nav>

          {selected && (
            <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <h2 className="mb-5 text-2xl font-bold tracking-tight">{selected.title}</h2>
              <RichTextViewer doc={selected.content} hierarchicalIndent />
            </article>
          )}
          {!selected && (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500 dark:text-slate-400">부속 이론 또는 단원을 선택하세요.</p>
            </div>
          )}
        </div>
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

function TheoryNavBranch({ document, subjectId, selectedId, childrenOf, expanded, onToggle, depth = 0 }: {
  document: TheoryDocument; subjectId: string; selectedId?: string; childrenOf: (id: string) => TheoryDocument[]; expanded: Set<string>; onToggle: (id: string) => void; depth?: number
}) {
  const children = childrenOf(document.id)
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(document.id)
  return <div>
    <TheoryNavItem document={document} subjectId={subjectId} selectedId={selectedId} group={hasChildren} depth={depth} expanded={isExpanded} onToggle={hasChildren ? () => onToggle(document.id) : undefined} />
    {hasChildren && isExpanded && children.map((child) => <TheoryNavBranch key={child.id} document={child} subjectId={subjectId} selectedId={selectedId} childrenOf={childrenOf} expanded={expanded} onToggle={onToggle} depth={depth + 1} />)}
  </div>
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

  if (!document.hasContent) return <div className={className}>{label}{onToggle && <button type="button" onClick={onToggle} aria-label={`${document.title} ${expanded ? '접기' : '펼치기'}`} className="px-1 text-slate-400">{expanded ? '⌄' : '›'}</button>}</div>

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
