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
import { collapseIdentical, fetchCollapseSetting } from '@/lib/queries/clusters'
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

/** 결과에서 보여 줄 한 단원의 성적. */
type UnitScore = { name: string; correct: number; total: number }

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

    void Promise.all([fetchQuestions({ examId }), fetchCollapseSetting()])
      .then(([rows, collapse]) => {
        if (!active) return
        // 서술형은 자동 채점이 안 되므로 블록테스트에서는 제외한다.
        const usable = rows.filter((row) => row.questionType !== 'essay')
        // 블록테스트는 시험 하나만 담으므로 접히는 문제는 사실상 없다. 판본 중복은
        // 학번을 가로질러 생기기 때문이다. 설정을 일관되게 적용하려고 걸어둔다.
        setLoaded({ key: examId, questions: collapse ? collapseIdentical(usable) : usable })
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

  // 소요 시간은 제한시간이 없는 시험에서도 재야 해서 따로 남긴다.
  const startedAt = useRef<number | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)

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
      setElapsedSec(
        startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0,
      )
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
      startedAt.current = Date.now()
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
          <ResultView
            results={results}
            examId={examId}
            elapsedSec={elapsedSec}
            onExit={() => navigate(`/exams/${examId}`)}
          />
        ) : (
          <Notice text="이 시험에는 풀 문제가 없습니다." />
        )}
      </main>
    </div>
  )
}

/**
 * 채점 결과.
 *
 * 점수만 보여 주면 다시 칠 이유가 없다. 어느 단원이 약했는지와 틀린 문항이
 * 무엇인지까지 한자리에서 보여, 이 화면에서 바로 다음 공부로 넘어가게 한다.
 */
function ResultView({
  results,
  examId,
  elapsedSec,
  onExit,
}: {
  results: Graded[]
  examId: string
  elapsedSec: number
  onExit: () => void
}) {
  const { taxonomy } = useData()
  const [filter, setFilter] = useState<'all' | 'wrong' | 'blank'>('all')

  // 정답이 확정되지 않은 문제는 채점할 수 없어 분모에서 뺀다.
  const gradable = results.filter((row) => row.isCorrect !== null)
  const correct = results.filter((row) => row.isCorrect === true).length
  const ungraded = results.length - gradable.length
  const blank = results.filter((row) => row.selected.length === 0).length
  const rate = gradable.length > 0 ? Math.round((correct / gradable.length) * 100) : 0

  /** 단원별 성적. 채점된 문항만 세고, 낮은 순으로 놓아 약한 곳이 먼저 보이게 한다. */
  const byUnit = useMemo(() => {
    const buckets = new Map<string, UnitScore>()
    for (const row of results) {
      if (row.isCorrect === null) continue
      const key = row.question.unitId ?? ''
      const name = row.question.unitId
        ? (taxonomy?.unitById.get(row.question.unitId)?.name ?? '미분류')
        : '미분류'
      const bucket = buckets.get(key) ?? { name, correct: 0, total: 0 }
      bucket.total += 1
      if (row.isCorrect) bucket.correct += 1
      buckets.set(key, bucket)
    }
    return [...buckets.values()].sort(
      (a, b) => a.correct / a.total - b.correct / b.total || b.total - a.total,
    )
  }, [results, taxonomy])

  const shown = results.filter((row) => {
    if (filter === 'wrong') return row.isCorrect === false
    if (filter === 'blank') return row.selected.length === 0
    return true
  })

  const wrongIds = results.filter((row) => row.isCorrect === false).map((row) => row.question.id)

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900">
        <h1 className="text-xl font-bold">채점 결과</h1>
        <p className="mt-2 text-3xl font-bold tabular-nums text-brand-600 dark:text-brand-300">
          {correct} / {gradable.length}
        </p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">정답률 {rate}%</p>
        <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>소요 {formatDuration(elapsedSec)}</span>
          {gradable.length > 0 && <span>문항당 {formatDuration(Math.round(elapsedSec / gradable.length))}</span>}
          {blank > 0 && <span className="text-amber-600 dark:text-amber-400">미응답 {blank}문항</span>}
          {ungraded > 0 && <span>정답 미확정 {ungraded}문항은 채점 제외</span>}
        </div>
      </div>

      {byUnit.length > 1 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold">단원별 정답률</h2>
          <ul className="space-y-2">
            {byUnit.map((unit) => {
              const percent = Math.round((unit.correct / unit.total) * 100)
              return (
                <li key={unit.name} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-xs text-slate-600 dark:text-slate-300">
                    {unit.name}
                  </span>
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <span
                      className={cn(
                        'block h-full rounded-full',
                        percent >= 80 ? 'bg-sky-500' : percent >= 50 ? 'bg-amber-500' : 'bg-pink-500',
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                    {unit.correct}/{unit.total} · {percent}%
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>
            {`전체 ${results.length}`}
          </FilterButton>
          <FilterButton active={filter === 'wrong'} onClick={() => setFilter('wrong')}>
            {`틀린 문항 ${wrongIds.length}`}
          </FilterButton>
          {blank > 0 && (
            <FilterButton active={filter === 'blank'} onClick={() => setFilter('blank')}>
              {`미응답 ${blank}`}
            </FilterButton>
          )}
        </div>

        {shown.length === 0 ? (
          <Notice text={filter === 'wrong' ? '틀린 문항이 없습니다.' : '해당하는 문항이 없습니다.'} />
        ) : (
          <ul className="space-y-1">
            {shown.map((row) => (
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
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-400 dark:text-slate-500">
                    {row.question.unitId
                      ? (taxonomy?.unitById.get(row.question.unitId)?.name ?? '미분류')
                      : '미분류'}
                  </span>
                  <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    {row.selected.length === 0 ? '미응답' : `선택 ${row.selected.join(', ')}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onExit}>시험 화면으로</Button>
        {wrongIds.length > 0 && (
          <Link
            to={`/solve?questions=${wrongIds.join(',')}`}
            className="inline-flex h-10 items-center rounded-lg bg-pink-600 px-4 text-sm font-medium text-white hover:bg-pink-700"
          >
            틀린 문항만 다시 풀기
          </Link>
        )}
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

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
          : 'border-slate-300 text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}

/** 초를 "12분 30초" 로. 한 시간이 넘는 시험은 없어 시간 단위는 두지 않는다. */
function formatDuration(totalSec: number): string {
  const safe = Math.max(0, totalSec)
  const minutes = Math.floor(safe / 60)
  const seconds = safe % 60
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`
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
