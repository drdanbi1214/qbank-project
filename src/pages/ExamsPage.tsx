import { Link } from 'react-router-dom'
import { ProgressBadge } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'

/** 시험 묶음(있으면) -> 과목 -> 차수 순으로 시험을 나열한다. */
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
  const groups = [...new Map(
    exams.map((exam) => {
      // curriculum이 없는 기존 학년말고사는 이전처럼 학번이 최상위 그룹이다.
      const label = exam.curriculum ?? exam.cohort
      const key = exam.curriculum ? `curriculum:${exam.curriculum}` : `cohort:${exam.cohort}`
      return [key, { label, exams: exams.filter((item) => (item.curriculum ? `curriculum:${item.curriculum}` : `cohort:${item.cohort}`) === key) }]
    }),
  ).values()].sort((a, b) => b.label.localeCompare(a.label, 'ko'))

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
          {groups.map((group) => (
            <div key={group.label}>
              <h2 className="mb-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                {group.label}
              </h2>
              <div className="space-y-3">
                {[...new Set(group.exams.map((exam) => exam.examSubjectLabel ?? exam.subjectId))]
                  .sort((a, b) => {
                    const left = group.exams.find((exam) => (exam.examSubjectLabel ?? exam.subjectId) === a)
                    const right = group.exams.find((exam) => (exam.examSubjectLabel ?? exam.subjectId) === b)
                    const leftSubject = left ? taxonomy?.subjectById.get(left.subjectId) : undefined
                    const rightSubject = right ? taxonomy?.subjectById.get(right.subjectId) : undefined
                    return (leftSubject?.sortOrder ?? 0) - (rightSubject?.sortOrder ?? 0) || a.localeCompare(b, 'ko')
                  })
                  .map((subjectKey) => {
                    const subjectExams = group.exams
                      .filter((exam) => (exam.examSubjectLabel ?? exam.subjectId) === subjectKey)
                      .sort((a, b) => (a.examDate ?? '').localeCompare(b.examDate ?? '') || a.examName.localeCompare(b.examName, 'ko'))

                    return (
                      <section key={subjectKey}>
                        <h3 className="mb-1 px-1 text-sm font-semibold">
                          {subjectExams[0]?.examSubjectLabel ?? taxonomy?.subjectById.get(subjectExams[0]?.subjectId ?? '')?.name ?? '과목'}
                        </h3>
                        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                          {subjectExams.map((exam) => {
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
                                      <span className="block truncate text-sm font-medium">{exam.examName}</span>
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
                      </section>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
