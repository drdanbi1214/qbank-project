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
  const selected = documents.find((item) => item.id === documentId) ?? documents[0] ?? null

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
            {documents.map((document) => (
              <Link
                key={document.id}
                to={`/theory/${subject.id}/${document.id}`}
                className={cn(
                  'block rounded-lg px-3 py-2 text-sm transition-colors',
                  selected?.id === document.id
                    ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                )}
              >
                {document.title}
                {document.unitId && (
                  <span className="mt-0.5 block text-xs font-normal text-slate-400">
                    {taxonomy?.unitById.get(document.unitId)?.name ?? '단원' }
                  </span>
                )}
              </Link>
            ))}
          </nav>

          {selected && (
            <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <h2 className="mb-4 text-lg font-bold">{selected.title}</h2>
              <RichTextViewer doc={selected.content} />
            </article>
          )}
        </div>
      )}
    </section>
  )
}
