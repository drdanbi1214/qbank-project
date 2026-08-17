import { Link } from 'react-router-dom'
import { ProgressBadge } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'

/** 학번 -> 과목 순으로 시험을 나열한다. */
export function ExamsPage() {
  const { taxonomy, loading, examProgress } = useData()

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  const exams = taxonomy?.exams ?? []
  const cohorts = [...new Set(exams.map((exam) => exam.cohort))].sort((a, b) =>
    b.localeCompare(a, 'ko'),
  )

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">시험별 보기</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          학번과 과목으로 기출을 찾아보세요.
        </p>
      </header>

      {exams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 시험이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {cohorts.map((cohort) => (
            <div key={cohort}>
              <h2 className="mb-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                {cohort}
              </h2>
              <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                {exams
                  .filter((exam) => exam.cohort === cohort)
                  .map((exam) => {
                    const subjectName =
                      taxonomy?.subjectById.get(exam.subjectId)?.name ?? '과목'
                    const label = `${subjectName} ${exam.examName}`
                    const restored =
                      exam.restoredQuestions !== null && exam.totalQuestions !== null
                        ? `${exam.restoredQuestions}/${exam.totalQuestions} 복기`
                        : null

                    return (
                      <li key={exam.id}>
                        <div className="flex items-center gap-1 px-2">
                          <Link
                            to={`/exams/${exam.id}`}
                            className="flex min-w-0 flex-1 items-center justify-between gap-3 px-2 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium">{label}</span>
                              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                                {[restored, exam.format, exam.examDate].filter(Boolean).join(' | ')}
                              </span>
                            </span>
                            <ProgressBadge progress={examProgress(exam.id)} />
                          </Link>

                          <Link
                            to={`/print?source=exam&exam=${exam.id}`}
                            target="_blank"
                            rel="noreferrer"
                            title="문제집 인쇄/PDF 저장 화면 열기"
                            aria-label="문제집 인쇄/PDF 저장 화면 열기"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            📄
                          </Link>
                        </div>
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
