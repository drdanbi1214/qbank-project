import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'

export function TheoryIndexPage() {
  const { taxonomy, loading: taxonomyLoading } = useData()
  const [documents, setDocuments] = useState<TheoryDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchTheoryDocuments()
      .then((rows) => {
        if (active) setDocuments(rows)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '이론을 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [])

  const counts = useMemo(() => {
    const result = new Map<string, number>()
    for (const document of documents ?? []) {
      result.set(document.subjectId, (result.get(document.subjectId) ?? 0) + 1)
    }
    return result
  }, [documents])

  if (taxonomyLoading || documents === null) {
    return <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
  }

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">이론 보기</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          과목을 선택해 핵심 이론과 단원별 정리를 확인하세요.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">{error}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(taxonomy?.subjects ?? []).map((subject) => (
            <li key={subject.id}>
              <Link
                to={`/theory/${subject.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
                  <Icon name="theory" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{subject.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    이론 {counts.get(subject.id) ?? 0}개
                  </span>
                </span>
                <Icon name="chevron-right" size={18} className="text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
