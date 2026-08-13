import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import { cn } from '@/utils/cn'

export function TheorySubjectPage() {
  const { subjectId, documentId } = useParams()
  const { taxonomy, loading: taxonomyLoading } = useData()
  const [documents, setDocuments] = useState<TheoryDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  const compareTheory = (a: TheoryDocument, b: TheoryDocument) =>
    a.title.localeCompare(b.title, 'ko', { numeric: true }) || a.sortOrder - b.sortOrder
  const topLevel = documents.filter((document) => document.parentId === null).sort(compareTheory)
  const childrenOf = (parentId: string) => documents.filter((document) => document.parentId === parentId).sort(compareTheory)
  const current = documents.find((item) => item.id === documentId) ?? null
  const selected = current?.hasContent ? current : null
  const navItems = current && !current.hasContent ? childrenOf(current.id) : current?.parentId ? childrenOf(current.parentId) : topLevel
  const parent = current?.parentId ? documents.find((item) => item.id === current.parentId) ?? null : null

  return (
    <section>
      <header className="mb-4">
        <Link to="/theory" className="text-xs text-slate-500 hover:underline dark:text-slate-400">이론 보기</Link>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold">{subject.name} 이론</h1>
          <Link to={`/study/${subject.id}`} className="shrink-0 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">문제 학습</Link>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{error}</p>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">아직 등록된 이론이 없습니다.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
            {current && !current.hasContent && parent && (
              <Link to={`/theory/${subject.id}/${parent.id}`} className="mb-1 block rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">← {parent.title}</Link>
            )}
            {current && current.hasContent && parent && (
              <Link to={`/theory/${subject.id}/${parent.id}`} className="mb-1 block rounded-lg px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800">← {parent.title}</Link>
            )}
            {navItems.map((document) => <TheoryNavItem key={document.id} document={document} subjectId={subject.id} selectedId={selected?.id} group={childrenOf(document.id).length > 0} />)}
          </nav>

          {selected && (
            <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <h2 className="mb-4 text-lg font-bold">{selected.title}</h2>
              <RichTextViewer doc={selected.content} />
            </article>
          )}
          {current && !current.hasContent && (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500 dark:text-slate-400">목차에서 이론을 선택하세요.</p>
            </div>
          )}
          {!current && (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <p className="text-sm text-slate-500 dark:text-slate-400">부속 이론 또는 단원을 선택하세요.</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function TheoryNavItem({
  document,
  subjectId,
  selectedId,
  group = false,
}: {
  document: TheoryDocument
  subjectId: string
  selectedId?: string
  group?: boolean
}) {
  const label = <span className={cn('min-w-0 truncate', group && 'font-semibold')}>{document.title}</span>
  const className = cn(
    'flex min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
    selectedId === document.id
      ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
      : document.hasContent ? 'hover:bg-slate-50 dark:hover:bg-slate-800' : 'text-slate-700 dark:text-slate-200',
  )

  if (!document.hasContent) {
    return group ? <Link to={`/theory/${subjectId}/${document.id}`} className={className}>{label}<span className="text-xs text-slate-400">목차</span></Link> : <div className={className}>{label}</div>
  }

  return (
    <Link to={`/theory/${subjectId}/${document.id}`} className={className}>
      {label}
      <span className="shrink-0 rounded border border-brand-200 px-1.5 py-0.5 text-[11px] font-medium text-brand-700 dark:border-brand-800 dark:text-brand-200">
        이론 보기
      </span>
    </Link>
  )
}
