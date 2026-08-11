import { Link, Navigate, useParams } from 'react-router-dom'
import { ResetProgressMenu } from '@/components/ResetProgressMenu'
import { ProgressBadge } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'

/** 과목 하위 단원 목록. 단원마다 진행률과 정답률을 보여준다. */
export function SubjectPage() {
  const { subjectId } = useParams()
  const { taxonomy, loading, unitProgress, subjectProgress } = useData()

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }
  if (!subjectId) return <Navigate to="/study" replace />

  const subject = taxonomy?.subjectById.get(subjectId)
  if (!subject) {
    return (
      <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        과목을 찾을 수 없습니다.
      </p>
    )
  }

  const units = taxonomy?.units.filter((unit) => unit.subjectId === subjectId) ?? []
  const unlabeled = unitProgress(null)
  const total = subjectProgress(subjectId)

  return (
    <section>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <Link
            to="/study"
            className="text-xs text-slate-500 hover:underline dark:text-slate-400"
          >
            학습하기
          </Link>
          <h1 className="mt-0.5 text-xl font-bold">{subject.name}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            전체 {total.solved} / {total.total} 문제
          </p>
        </div>
        <Link
          to={`/solve?subject=${subjectId}`}
          className="inline-flex h-8 shrink-0 items-center rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          전체 풀기
        </Link>
      </header>

      {units.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 단원이 없습니다.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {units.map((unit) => (
            <li key={unit.id} className="flex items-center gap-2 pr-2">
              <Link
                to={`/study/${subjectId}/${unit.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className="truncate text-sm font-medium">{unit.name}</span>
                <ProgressBadge progress={unitProgress(unit.id)} />
              </Link>
              <ResetProgressMenu label={unit.name} scope={{ unitId: unit.id }} />
            </li>
          ))}

          {unlabeled.total > 0 && (
            <li>
              <Link
                to={`/study/${subjectId}/unlabeled`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">
                  미분류
                </span>
                <ProgressBadge progress={unlabeled} />
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}
