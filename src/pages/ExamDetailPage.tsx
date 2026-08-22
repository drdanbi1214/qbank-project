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
  const [actionFailure, setActionFailure] = useState<{ key: string; message: string } | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const requestKey = `${session?.user.id ?? ''}|${examId ?? ''}|${reloadNonce}`
  const [loaded, setLoaded] = useState<{
    key: string
    questions: SolveQuestion[]
    states: Map<string, QuestionState>
  } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)

  // 매 렌더마다 새 배열이 되면 아래 useMemo 가 계속 다시 계산된다.
  const fresh = loaded !== null && loaded.key === requestKey
  const questions = useMemo(() => (fresh ? loaded.questions : []), [fresh, loaded])
  const states = useMemo(
    () => (fresh ? loaded.states : new Map<string, QuestionState>()),
    [fresh, loaded],
  )
  const loadError = failed?.key === requestKey ? failed.message : null
  const questionLoading = !fresh && loadError === null
  const actionKey = `${session?.user.id ?? ''}|${examId ?? ''}`
  const actionError = actionFailure?.key === actionKey ? actionFailure.message : null

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
    setActionFailure(null)
    try {
      const id = await startSession({
        userId: session?.user.id ?? '',
        mode: 'wrong_only',
        scope: { exam_id: examId },
        questionIds: wrongIds,
      })
      navigate(`/solve?session=${id}`)
    } catch (caught) {
      setActionFailure({
        key: actionKey,
        message: caught instanceof Error ? caught.message : '오답 세션을 시작하지 못했습니다.',
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!examId || !session?.user.id) return
    let active = true

    async function load() {
      try {
        const rows = await fetchQuestions({ examId })
        const nextStates = await fetchQuestionStates(rows.map((row) => row.id))
        if (!active) return
        setLoaded({ key: requestKey, questions: rows, states: nextStates })
        setFailed(null)
      } catch (caught) {
        if (!active) return
        setFailed({
          key: requestKey,
          message: caught instanceof Error ? caught.message : '문항을 불러오지 못했습니다.',
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [examId, requestKey, session?.user.id])

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

        {actionError && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {actionError}
          </p>
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

      {questionLoading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
          <Spinner />
          <span>문항을 불러오는 중입니다.</span>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          <p>{loadError}</p>
          <button
            type="button"
            onClick={() => {
              setFailed(null)
              setReloadNonce((value) => value + 1)
            }}
            className="mt-3 inline-flex h-9 items-center rounded-lg border border-rose-300 bg-white px-4 font-medium hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950 dark:hover:bg-rose-900"
          >
            다시 시도
          </button>
        </div>
      ) : questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 문제가 없습니다.</p>
        </div>
      ) : null}

    </section>
  )
}
