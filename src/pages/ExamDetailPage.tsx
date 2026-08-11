import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
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
import { startSession } from '@/lib/queries/study'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'

/** 시험 상세. 총평과 풀기 방식 선택. */
export function ExamDetailPage() {
  const { examId } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { taxonomy, loading: taxonomyLoading, examProgress } = useData()
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState<{
    key: string
    questions: SolveQuestion[]
    states: Map<string, QuestionState>
  } | null>(null)

  // 매 렌더마다 새 배열이 되면 아래 useMemo 가 계속 다시 계산된다.
  const fresh = loaded !== null && loaded.key === examId
  const questions = useMemo(() => (fresh ? loaded.questions : []), [fresh, loaded])
  const states = useMemo(
    () => (fresh ? loaded.states : new Map<string, QuestionState>()),
    [fresh, loaded],
  )

  // 이 시험에서 마지막 시도가 오답이었던 문항
  const wrongIds = useMemo(
    () =>
      questions
        .filter((question) => {
          const state = states.get(question.id)
          return state && state.attempts > 0 && state.isCorrect === false
        })
        .map((question) => question.id),
    [questions, states],
  )
  const wrongCount = wrongIds.length

  async function retryWrong() {
    if (wrongIds.length === 0 || busy) return
    setBusy(true)
    try {
      const id = await startSession({
        userId: session?.user.id ?? '',
        mode: 'wrong_only',
        scope: { exam_id: examId },
        questionIds: wrongIds,
      })
      navigate(`/solve?session=${id}`)
    } catch (caught) {
      console.error('오답 세션을 시작하지 못했습니다.', caught)
    } finally {
      setBusy(false)
    }
  }

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
            {wrongCount > 0 && (
              <button
                type="button"
                onClick={() => void retryWrong()}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium hover:border-brand-400 disabled:opacity-60 dark:border-slate-600"
              >
                오답만 다시 풀기 ({wrongCount})
              </button>
            )}
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

    </section>
  )
}
