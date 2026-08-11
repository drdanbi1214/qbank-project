import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { ChoiceList } from '@/components/question/ChoiceList'
import { StemBlocks } from '@/components/question/StemBlocks'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { fetchQuestions, submitAttempt, type SolveQuestion } from '@/lib/queries/questions'
import { finishSession, startSession } from '@/lib/queries/study'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { cn } from '@/utils/cn'

/**
 * 블록테스트. 시험 한 세트를 제한시간 안에 푸는 모드.
 *
 * 일반 풀이와 달리 문항마다 정답을 보여주지 않고, 마지막에 한 번에 채점한다.
 * 그래서 QuestionView 를 쓰지 않고 본문과 보기만 따로 그린다.
 */
type Phase = 'intro' | 'running' | 'result'

type Graded = {
  question: SolveQuestion
  selected: number[]
  isCorrect: boolean | null
}

export function BlockTestPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { taxonomy, refreshProgress } = useData()
  const userId = session?.user.id ?? ''

  const examId = params.get('exam')
  const exam = examId ? taxonomy?.examById.get(examId) : undefined
  const examLabel = examShortLabel(
    exam,
    exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined,
  )

  const [phase, setPhase] = useState<Phase>('intro')
  const [loaded, setLoaded] = useState<{ key: string; questions: SolveQuestion[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [remainingSec, setRemainingSec] = useState<number | null>(null)
  const [results, setResults] = useState<Graded[] | null>(null)
  const [busy, setBusy] = useState(false)
  const sessionId = useRef<string | null>(null)

  useEffect(() => {
    if (!examId) return
    let active = true

    void fetchQuestions({ examId })
      .then((rows) => {
        if (!active) return
        // 서술형은 자동 채점이 안 되므로 블록테스트에서는 제외한다.
        setLoaded({ key: examId, questions: rows.filter((row) => row.questionType !== 'essay') })
        setError(null)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
        }
      })

    return () => {
      active = false
    }
  }, [examId])

  // 매 렌더마다 새 배열이 되면 아래 useCallback 과 useMemo 가 계속 다시 만들어진다.
  const questions = useMemo(
    () => (loaded?.key === examId ? loaded.questions : []),
    [loaded, examId],
  )
  const current = questions[index] ?? null

  const grade = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const graded: Graded[] = []
      for (const question of questions) {
        const selected = answers[question.id] ?? []
        if (selected.length === 0) {
          // 답을 고르지 않은 문항은 기록을 남기지 않고 오답으로만 센다.
          graded.push({ question, selected, isCorrect: false })
          continue
        }
        const result = await submitAttempt({
          questionId: question.id,
          selected,
          timeSpentSec: null,
        })
        graded.push({ question, selected, isCorrect: result.isCorrect })
      }

      if (sessionId.current) await finishSession(sessionId.current)
      setResults(graded)
      setPhase('result')
      refreshProgress()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '채점하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [busy, questions, answers, refreshProgress])

  // 제한시간 카운트다운. 0 이 되면 자동 제출한다.
  // 채점은 렌더 흐름 밖으로 미뤄서 효과 안에서 상태를 연쇄로 바꾸지 않는다.
  useEffect(() => {
    if (phase !== 'running' || remainingSec === null) return

    const delay = remainingSec <= 0 ? 0 : 1000
    const timer = window.setTimeout(() => {
      if (remainingSec <= 0) void grade()
      else setRemainingSec((value) => (value ?? 0) - 1)
    }, delay)

    return () => window.clearTimeout(timer)
  }, [phase, remainingSec, grade])

  async function start() {
    if (questions.length === 0 || busy) return
    setBusy(true)
    try {
      const limit = exam?.durationMin ? exam.durationMin * 60 : null
      sessionId.current = await startSession({
        userId,
        mode: 'block_test',
        scope: { exam_id: examId },
        questionIds: questions.map((row) => row.id),
        timeLimitSec: limit,
      })
      setRemainingSec(limit)
      setPhase('running')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const answeredCount = useMemo(
    () => questions.filter((question) => (answers[question.id] ?? []).length > 0).length,
    [questions, answers],
  )

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <Header />

      <main className="mx-auto max-w-3xl px-3 pb-28 pt-4 sm:px-4">
        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {!examId ? (
          <Notice text="시험을 선택해주세요." />
        ) : loaded?.key !== examId && error === null ? (
          <div className="flex justify-center py-20">
            <Spinner className="h-7 w-7" />
          </div>
        ) : phase === 'intro' ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
            <h1 className="text-xl font-bold">{examLabel} 블록테스트</h1>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              총 {questions.length}문항
              {exam?.durationMin ? ` / 제한시간 ${exam.durationMin}분` : ' / 제한시간 없음'}
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              문항마다 정답을 보여주지 않고 마지막에 한 번에 채점합니다.
              서술형은 자동 채점이 어려워 제외됩니다.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Button size="lg" onClick={() => void start()} disabled={busy || questions.length === 0}>
                {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                시작하기
              </Button>
              <Button size="lg" variant="secondary" onClick={() => navigate(`/exams/${examId}`)}>
                돌아가기
              </Button>
            </div>
          </section>
        ) : phase === 'running' && current ? (
          <section>
            <header className="mb-3 flex items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
              <span className="text-sm font-medium">
                {index + 1} / {questions.length}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                답한 문항 {answeredCount}개
              </span>
              {remainingSec !== null && (
                <span
                  className={cn(
                    'rounded-lg px-2 py-1 text-sm font-bold tabular-nums',
                    remainingSec <= 60
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900',
                  )}
                >
                  {formatClock(remainingSec)}
                </span>
              )}
            </header>

            <h2 className="mb-2 text-base font-bold">{current.questionNumber}번</h2>
            <StemBlocks blocks={current.stemBlocks} />

            <div className="mt-4">
              <ChoiceList
                choices={current.choices}
                selected={answers[current.id] ?? []}
                onChange={(next) => setAnswers((prev) => ({ ...prev, [current.id]: next }))}
                revealed={null}
              />
            </div>

            {/* 문항 이동 격자. 어디를 안 풀었는지 한눈에 보인다. */}
            <div className="mt-5 flex flex-wrap gap-1">
              {questions.map((question, position) => (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => setIndex(position)}
                  className={cn(
                    'h-8 w-8 rounded-lg text-xs font-medium transition-colors',
                    position === index
                      ? 'bg-brand-600 text-white'
                      : (answers[question.id] ?? []).length > 0
                        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
                  )}
                >
                  {question.questionNumber}
                </button>
              ))}
            </div>

            <div
              className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
              style={{ paddingBottom: 'calc(0.5rem + var(--safe-bottom))' }}
            >
              <div className="mx-auto flex max-w-3xl items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setIndex((value) => Math.max(0, value - 1))}
                  disabled={index === 0}
                >
                  이전
                </Button>
                {index < questions.length - 1 ? (
                  <Button block size="lg" onClick={() => setIndex((value) => value + 1)}>
                    다음
                  </Button>
                ) : (
                  <Button block size="lg" onClick={() => void grade()} disabled={busy}>
                    {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                    제출하고 채점하기
                  </Button>
                )}
              </div>
            </div>
          </section>
        ) : phase === 'result' && results ? (
          <ResultView results={results} examId={examId} onExit={() => navigate(`/exams/${examId}`)} />
        ) : (
          <Notice text="이 시험에는 풀 문제가 없습니다." />
        )}
      </main>
    </div>
  )
}

function ResultView({
  results,
  examId,
  onExit,
}: {
  results: Graded[]
  examId: string
  onExit: () => void
}) {
  // 정답이 확정되지 않은 문제는 채점할 수 없어 분모에서 뺀다.
  const gradable = results.filter((row) => row.isCorrect !== null)
  const correct = results.filter((row) => row.isCorrect === true).length
  const ungraded = results.length - gradable.length
  const rate = gradable.length > 0 ? Math.round((correct / gradable.length) * 100) : 0

  return (
    <section>
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-bold">채점 결과</h1>
        <p className="mt-2 text-3xl font-bold tabular-nums text-brand-600 dark:text-brand-300">
          {correct} / {gradable.length}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">정답률 {rate}%</p>
        {ungraded > 0 && (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            정답 미확정 {ungraded}문항은 채점에서 제외했습니다.
          </p>
        )}
      </div>

      <ul className="mt-4 space-y-1">
        {results.map((row) => (
          <li key={row.question.id}>
            <Link
              to={`/solve?question=${row.question.id}`}
              className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
            >
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white',
                  row.isCorrect === null
                    ? 'bg-slate-400'
                    : row.isCorrect
                      ? 'bg-sky-600'
                      : 'bg-pink-600',
                )}
              >
                {row.isCorrect === null ? '-' : row.isCorrect ? 'O' : 'X'}
              </span>
              <span className="text-sm font-medium">{row.question.questionNumber}번</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
                {row.selected.length === 0 ? '미응답' : `선택 ${row.selected.join(', ')}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={onExit}>시험 화면으로</Button>
        <Link
          to={`/block-test?exam=${examId}`}
          reloadDocument
          className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium dark:border-slate-600"
        >
          다시 풀기
        </Link>
      </div>
    </section>
  )
}

function Notice({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
      <p className="text-sm text-slate-500 dark:text-slate-400">{text}</p>
    </div>
  )
}

function formatClock(totalSec: number): string {
  const safe = Math.max(0, totalSec)
  const minutes = String(Math.floor(safe / 60)).padStart(2, '0')
  const seconds = String(safe % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}
