import { Link } from 'react-router-dom'
import { ProgressBadge } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'

type ExamGroup = {
  key: string
  label: string
  isCurriculum: boolean
  sortYear: number
  exams: NonNullable<ReturnType<typeof useData>['taxonomy']>['exams']
}

function cohortYear(cohort: string): number {
  const match = cohort.match(/^(\d{2})학번$/)
  return match ? 2000 + Number(match[1]) : Number(cohort.match(/\d{4}/)?.[0] ?? 0)
}

function cohortExamLabel(cohort: string): string {
  const year = cohortYear(cohort)
  return year > 0 ? `${year}년도 학년말고사` : `${cohort} 학년말고사`
}

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
  const groupMap = new Map<string, ExamGroup>()
  for (const exam of exams) {
    const isCurriculum = Boolean(exam.curriculum)
    const key = isCurriculum ? `curriculum:${exam.curriculum}` : `cohort:${exam.cohort}`
    const existing = groupMap.get(key)
    if (existing) {
      existing.exams.push(exam)
      continue
    }
    groupMap.set(key, {
      key,
      label: exam.curriculum ?? cohortExamLabel(exam.cohort),
      isCurriculum,
      sortYear: exam.curriculum
        ? Number(exam.curriculum.match(/\d{4}/)?.[0] ?? 0)
        : cohortYear(exam.cohort),
      exams: [exam],
    })
  }
  const groups = [...groupMap.values()].sort((a, b) => {
    // 학기·계통 시험은 기존 연도별 학년말고사보다 먼저 보여준다.
    if (a.isCurriculum !== b.isCurriculum) return a.isCurriculum ? -1 : 1
    return b.sortYear - a.sortYear || b.label.localeCompare(a.label, 'ko')
  })

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">시험별 보기</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          연도별 학년말고사와 교육과정 시험을 찾아보세요.
        </p>
      </header>

      {exams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 시험이 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-1.5 px-0.5 text-sm font-bold text-slate-600 dark:text-slate-300">
                {group.label}
              </h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
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
                      <section
                        key={subjectKey}
                        className="border-b border-slate-200 last:border-b-0 sm:grid sm:grid-cols-[9rem_minmax(0,1fr)] dark:border-slate-700"
                      >
                        <h3 className="flex items-center bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 sm:py-2.5 dark:bg-slate-800/70 dark:text-slate-200">
                          {subjectExams[0]?.examSubjectLabel ?? taxonomy?.subjectById.get(subjectExams[0]?.subjectId ?? '')?.name ?? '과목'}
                        </h3>
                        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                          {subjectExams.map((exam) => {
                            const restored =
                              exam.restoredQuestions !== null && exam.totalQuestions !== null
                                ? `${exam.restoredQuestions}/${exam.totalQuestions} 복기`
                                : null

                            return (
                              <li key={exam.id} className="min-w-0 bg-white dark:bg-slate-900">
                                <div className="flex min-h-14 items-center gap-0.5 px-1.5">
                                  <Link
                                    to={`/exams/${exam.id}`}
                                    className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                                  >
                                    <span className="min-w-0">
                                      <span className="block truncate text-sm font-semibold">{exam.examName}</span>
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
                                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
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
            </section>
          ))}
        </div>
      )}
    </section>
  )
}
