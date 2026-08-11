import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ResetProgressMenu } from '@/components/ResetProgressMenu'
import { ProgressBar } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchQuestionStates,
  fetchQuestions,
  type QuestionState,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { examTitle } from '@/lib/queries/taxonomy'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

/** 시험 상세. 총평과 문항 목록, 블록테스트 시작 버튼. */
export function ExamDetailPage() {
  const { examId } = useParams()
  const { taxonomy, loading: taxonomyLoading, examProgress } = useData()
  const [loaded, setLoaded] = useState<{
    key: string
    questions: SolveQuestion[]
    states: Map<string, QuestionState>
  } | null>(null)

  const fresh = loaded !== null && loaded.key === examId
  const questions = fresh ? loaded.questions : []
  const states = fresh ? loaded.states : new Map<string, QuestionState>()
  const loading = !fresh

  useEffect(() => {
    if (!examId) return
    const currentExamId = examId
    let active = true

    async function load() {
      try {
        const rows = await fetchQuestions({ examId })
        const nextStates = await fetchQuestionStates(rows.map((row) => row.id))
        if (active) setLoaded({ key: currentExamId, questions: rows, states: nextStates })
      } catch (caught) {
        console.error('문항을 불러오지 못했습니다.', caught)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [examId])

  if (!examId) return <Navigate to="/exams" replace />
  if (taxonomyLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  const exam = taxonomy?.examById.get(examId)
  if (!exam) {
    return (
      <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
        시험을 찾을 수 없습니다.
      </p>
    )
  }

  const subjectName = taxonomy?.subjectById.get(exam.subjectId)?.name
  const progress = examProgress(examId)

  return (
    <section>
      <header className="mb-4">
        <Link to="/exams" className="text-xs text-slate-500 hover:underline dark:text-slate-400">
          시험별 보기
        </Link>
        <div className="mt-0.5 flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold">{examTitle(exam, subjectName)}</h1>
          <ResetProgressMenu label={examTitle(exam, subjectName)} scope={{ examId }} />
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {[
            exam.examDate,
            exam.format,
            exam.durationMin ? `${exam.durationMin}분` : null,
            exam.restoredQuestions !== null && exam.totalQuestions !== null
              ? `${exam.restoredQuestions}/${exam.totalQuestions} 복기`
              : null,
          ]
            .filter(Boolean)
            .join(' | ')}
        </p>

        <div className="mt-3">
          <ProgressBar progress={progress} />
          <p className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {progress.solved} / {progress.total} 문제
          </p>
        </div>

        {questions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to={`/solve?exam=${examId}`}
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
            >
              순서대로 풀기
            </Link>
            <Link
              to={`/block-test?exam=${examId}`}
              className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium hover:border-brand-400 dark:border-slate-600"
            >
              블록테스트 {exam.durationMin ? `(${exam.durationMin}분)` : ''}
            </Link>
          </div>
        )}
      </header>

      {exam.overview && (
        <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-1 text-sm font-semibold">총평</h2>
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">
            {exam.overview}
          </p>
        </section>
      )}

      <h2 className="mb-2 text-sm font-bold text-slate-500 dark:text-slate-400">
        문항 {questions.length}개
      </h2>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 문항이 없습니다.</p>
        </div>
      ) : (
        <ol className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
          {questions.map((question, index) => {
            const state = states.get(question.id)
            const solved = state && state.attempts > 0

            return (
              <li key={question.id}>
                <Link
                  to={`/solve?exam=${examId}&i=${index}`}
                  title={`${question.questionNumber}번`}
                  className={cn(
                    'grid aspect-square place-items-center rounded-lg border text-sm font-medium transition-colors',
                    !solved
                      ? 'border-slate-200 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      : state.isCorrect
                        ? 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
                        : 'border-pink-300 bg-pink-100 text-pink-700 dark:border-pink-800 dark:bg-pink-950/50 dark:text-pink-300',
                  )}
                >
                  {question.questionNumber}
                </Link>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
