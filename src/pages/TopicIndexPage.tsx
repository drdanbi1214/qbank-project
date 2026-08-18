import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { fetchAllTopicCounts } from '@/lib/queries/topics'

/**
 * 테마 첫 화면. 과목을 고르는 자리다.
 *
 * 이론 보기와 나란히 있지만 성격이 다르다. 이론은 Notion 에서 임포트한 교과
 * 정리이고, 테마는 스터디원이 주제 단위로 직접 쓰고 야마를 붙이는 글이다.
 */
export function TopicIndexPage() {
  const { taxonomy, loading: taxonomyLoading } = useData()
  const { isAdmin, hasPermission } = useAuth()
  const canUse = isAdmin || hasPermission('study_legendob')

  const [counts, setCounts] = useState<Map<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canUse) return
    let active = true
    void fetchAllTopicCounts()
      .then((rows) => {
        if (active) setCounts(rows)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '테마를 불러오지 못했습니다.')
          setCounts(new Map())
        }
      })
    return () => {
      active = false
    }
  }, [canUse])

  const total = useMemo(
    () => [...(counts?.values() ?? [])].reduce((sum, value) => sum + value, 0),
    [counts],
  )

  if (!canUse) return <Navigate to="/study" replace />

  if (taxonomyLoading || counts === null) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  return (
    <section>
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">테마</h1>
          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
            레전드옵세스터디
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          주제 하나를 정리하고 관련된 야마를 붙여 나가는 곳입니다. 지금까지 {total}개.
        </p>
      </header>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(taxonomy?.subjects ?? []).map((subject) => (
            <li key={subject.id}>
              <Link
                to={`/topics/${subject.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-emerald-400 dark:border-slate-700 dark:bg-slate-900"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
                  <Icon name="topic" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{subject.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                    테마 {counts.get(subject.id) ?? 0}개
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
