import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { ChoiceList } from '@/components/question/ChoiceList'
import { StemBlocks } from '@/components/question/StemBlocks'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'
import { blockDraftKey, parseBlockDraft, remainingSeconds, type BlockTestDraft } from '@/lib/blockTestDraft'
import { withReturnTo } from '@/lib/learningNavigation'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { fetchQuestions, fetchQuestionsByIds, submitAttempt, type SolveQuestion } from '@/lib/queries/questions'
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
const EMPTY_ANSWERS: Record<string, number[]> = {}
const EMPTY_QUESTIONS: SolveQuestion[] = []

type Graded = {
  question: SolveQuestion
  selected: number[]
  isCorrect: boolean | null
}

/** 결과에서 보여 줄 한 단원의 성적. */
type UnitScore = { name: string; correct: number; total: number }

export function BlockTestPage() {
  const [params] = useSearchParams()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const examId = params.get('exam')
  return <BlockTestWorkspace key={`${userId}:${examId}`} userId={userId} examId={examId} />
}

function BlockTestWorkspace({ userId, examId }: { userId: string; examId: string | null }) {
  const navigate = useNavigate()
  const { taxonomy, refreshProgress } = useData()
  const storageKey = blockDraftKey(userId, examId ?? '')
  const [draft, setDraft] = useState<BlockTestDraft | null>(() => {
    try { return parseBlockDraft(localStorage.getItem(storageKey)) } catch { return null }
  })
  const draftRef = useRef(draft)
  const [saveError, setSaveError] = useState(false)
  const persist = useCallback((next: BlockTestDraft | null) => {
    draftRef.current = next
    setDraft(next)
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
      setSaveError(false)
    } catch { setSaveError(true) }
  }, [storageKey])
  const exam = examId ? taxonomy?.examById.get(examId) : undefined
  const examLabel = examShortLabel(exam, exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined)
  const phase: Phase = draft?.phase ?? 'intro'
  const index = draft?.index ?? 0
  const answers = draft?.answers ?? EMPTY_ANSWERS
  const [now, setNow] = useState(Date.now)
  const remainingSec = remainingSeconds(draft?.deadline ?? null, now)
  const [loaded, setLoaded] = useState<SolveQuestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const grading = useRef(false)
  const questions = loaded ?? EMPTY_QUESTIONS
  const current = questions[index] ?? null
  const results: Graded[] | null = draft?.phase === 'result'
    ? questions.map((question) => ({ question, ...draft.grades[question.id] })) : null
  const elapsedSec = draft ? Math.max(0, Math.round(((draft.submittedAt ?? now) - draft.startedAt) / 1000)) : 0

  useEffect(() => {
    if (!examId) return
    let active = true
    async function load() {
      try {
        const saved = draftRef.current
        let rows: SolveQuestion[]
        if (saved) {
          rows = await fetchQuestionsByIds(saved.questionIds)
          if (rows.length !== saved.questionIds.length) throw new Error('저장된 시험의 일부 문제를 불러오지 못했습니다. 답안은 보관되어 있습니다.')
        } else {
          const [all, collapse] = await Promise.all([fetchQuestions({ examId: examId ?? undefined }), fetchCollapseSetting()])
          const usable = all.filter((row) => row.questionType !== 'essay')
          rows = collapse ? collapseIdentical(usable) : usable
        }
        if (active) { setLoaded(rows); setLoadError(null) }
      } catch (caught) {
        if (active) setLoadError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
      }
    }
    void load()
    return () => { active = false }
  }, [examId, loadNonce])

  const grade = useCallback(async () => {
    const saved = draftRef.current
    if (grading.current || !saved || saved.phase !== 'running' || questions.length === 0) return
    grading.current = true
    setBusy(true)
    setError(null)
    // Freeze answers and submission time on the first attempt. Successful grades are
    // checkpointed individually so a retry does not resubmit confirmed records.
    let next = { ...saved, submittedAt: saved.submittedAt ?? Math.min(Date.now(), saved.deadline ?? Infinity) }
    persist(next)
    try {
      for (const question of questions) {
        if (next.grades[question.id]) continue
        const selected = next.answers[question.id] ?? []
        const isCorrect = selected.length === 0 ? false : (await submitAttempt({
          questionId: question.id, selected, timeSpentSec: null,
        })).isCorrect
        next = { ...next, grades: { ...next.grades, [question.id]: { selected, isCorrect } } }
        persist(next)
      }
      await finishSession(next.sessionId)
      persist({ ...next, phase: 'result' })
      refreshProgress()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '채점하지 못했습니다. 답안을 보관했습니다. 다시 시도해 주세요.')
    } finally {
      grading.current = false
      setBusy(false)
    }
  }, [questions, persist, refreshProgress])

  useEffect(() => {
    if (phase !== 'running') return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (phase !== 'running' || remainingSec !== 0 || draft?.submittedAt !== null || !questions.length) return
    // One automatic submission; on failure the user explicitly retries.
    const timer = window.setTimeout(() => void grade(), 0)
    return () => window.clearTimeout(timer)
  }, [phase, remainingSec, draft?.submittedAt, questions.length, grade])

  const blocker = useBlocker(phase === 'running')
  useEffect(() => {
    if (phase !== 'running') return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  async function start() {
    if (!questions.length || busy) return
    setBusy(true)
    setError(null)
    try {
      const limit = exam?.durationMin ? exam.durationMin * 60 : null
      const sessionId = await startSession({ userId, mode: 'block_test', scope: { exam_id: examId },
        questionIds: questions.map((row) => row.id), timeLimitSec: limit })
      const startedAt = Date.now()
      persist({ version: 1, sessionId, questionIds: questions.map((row) => row.id), startedAt,
        deadline: limit === null ? null : startedAt + limit * 1000, submittedAt: null,
        phase: 'running', index: 0, answers: {}, grades: {} })
      setNow(startedAt)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '시작하지 못했습니다.')
    } finally { setBusy(false) }
  }

  function move(nextIndex: number) {
    const saved = draftRef.current
    if (saved) persist({ ...saved, index: Math.max(0, Math.min(questions.length - 1, nextIndex)) })
    window.scrollTo({ top: 0 })
  }

  function select(next: number[]) {
    const saved = draftRef.current
    if (!saved || !current || saved.submittedAt !== null || remainingSeconds(saved.deadline, Date.now()) === 0) return
    persist({ ...saved, answers: { ...saved.answers, [current.id]: next } })
  }

  function submit() {
    if (answeredCount < questions.length && draft?.submittedAt === null &&
      !window.confirm(`아직 답하지 않은 문항이 ${questions.length - answeredCount}개 있습니다. 제출할까요?`)) return
    void grade()
  }

  const answeredCount = questions.filter((question) => (answers[question.id] ?? []).length > 0).length

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <Header />

      <main className="mx-auto max-w-3xl px-3 pb-28 pt-4 sm:px-4">
        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {saveError && <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">이 브라우저에 답안을 저장하지 못했습니다. 새로고침하거나 나가면 복원할 수 없으니 시험을 마칠 때까지 이 화면을 유지해주세요.</p>}
        {phase === 'running' && !saveError && <p role="status" className="mb-3 text-xs text-slate-500">답안을 이 브라우저에 자동 저장합니다. 다시 들어오면 이어서 풀 수 있으며, 나가 있는 동안에도 제한시간은 흐릅니다.</p>}
        {phase === 'running' && draft?.submittedAt !== null && <Button className="mb-3" onClick={() => void grade()} disabled={busy}>{busy ? '채점 중…' : '채점 다시 시도'}</Button>}
        {!examId ? (
          <Notice text="시험을 선택해주세요." />
        ) : loadError ? (
          <div role="alert"><p>{loadError}</p><Button onClick={() => { setLoadError(null); setLoadNonce((n) => n + 1) }}>다시 불러오기</Button></div>
        ) : !loaded ? (
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
                onChange={select}
                disabled={busy || draft?.submittedAt !== null || remainingSec === 0}
                revealed={null}
              />
            </div>

            {/* 문항 이동 격자. 어디를 안 풀었는지 한눈에 보인다. */}
            <div className="mt-5 flex flex-wrap gap-1">
              {questions.map((question, position) => (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => move(position)}
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
                  onClick={() => move(index - 1)}
                  disabled={index === 0}
                >
                  이전
                </Button>
                {index < questions.length - 1 ? (
                  <Button block size="lg" onClick={() => move(index + 1)}>
                    다음
                  </Button>
                ) : (
                  <Button block size="lg" onClick={submit} disabled={busy}>
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
            onRestart={() => { persist(null); setError(null); setLoaded(null); setLoadNonce((n) => n + 1) }}
          />
        ) : (
          <Notice text="이 시험에는 풀 문제가 없습니다." />
        )}
      </main>
      {blocker.state === 'blocked' && <Modal title="시험에서 나갈까요?" onClose={() => blocker.reset()} footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => blocker.reset()}>계속 풀기</Button><Button disabled={busy} onClick={() => blocker.proceed()}>나가기</Button></div>}>
        <p className="text-sm">{busy ? '채점이 끝날 때까지 기다려주세요.' : saveError ? '답안을 저장하지 못했습니다. 나가면 작성한 답안을 잃을 수 있습니다.' : '답안은 이 브라우저에 저장되어 있습니다. 같은 시험에 다시 들어오면 이어서 풀 수 있습니다. 제한시간은 계속 흐릅니다.'}</p>
      </Modal>}
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
  onRestart,
}: {
  results: Graded[]
  examId: string
  elapsedSec: number
  onExit: () => void
  onRestart: () => void
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
                  to={withReturnTo(`/solve?question=${row.question.id}`, `/block-test?exam=${examId}`)}
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
            to={withReturnTo(`/solve?questions=${wrongIds.join(',')}`, `/block-test?exam=${examId}`)}
            className="inline-flex h-10 items-center rounded-lg bg-pink-600 px-4 text-sm font-medium text-white hover:bg-pink-700"
          >
            틀린 문항만 다시 풀기
          </Link>
        )}
        <Button variant="secondary" onClick={onRestart}>
          다시 풀기
        </Button>
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
