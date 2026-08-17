import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResetProgressMenu } from '@/components/ResetProgressMenu'
import { DailyChallengeStatsModal } from '@/components/study/DailyChallengeStatsModal'
import { ProgressBar } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { accuracy, useData } from '@/lib/data'
import {
  ensureDailySession,
  fetchDailyChallengeStats,
  fetchOpenSession,
  type DailyChallengeStats,
  type StudySession,
} from '@/lib/queries/study'
import { examShortLabel, type Taxonomy } from '@/lib/queries/taxonomy'

const SESSION_LABEL: Record<string, string> = {
  sequential: '순서대로 풀기',
  block_test: '블록테스트',
  wrong_only: '오답 재풀이',
  bookmark: '북마크 재풀이',
}

/** 세션이 어느 단원/시험/과목 범위였는지, 있는 대로 가장 구체적인 이름을 찾는다. */
function sessionScopeLabel(session: StudySession, taxonomy: Taxonomy | null): string | null {
  if (!taxonomy) return null
  const scope = session.scope
  const unitId = typeof scope.unit_id === 'string' ? scope.unit_id : null
  const examId = typeof scope.exam_id === 'string' ? scope.exam_id : null
  const subjectId = typeof scope.subject_id === 'string' ? scope.subject_id : null

  if (unitId) {
    const unit = taxonomy.unitById.get(unitId)
    if (unit) return unit.name
  }
  if (examId) {
    const exam = taxonomy.examById.get(examId)
    const subjectName = exam ? taxonomy.subjectById.get(exam.subjectId)?.name : undefined
    const label = examShortLabel(exam, subjectName)
    if (label) return label
  }
  if (subjectId) {
    const subject = taxonomy.subjectById.get(subjectId)
    if (subject) return subject.name
  }
  return null
}

const TILE_COLORS = [
  'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
]

export function StudyHomePage() {
  const { taxonomy, loading, subjectProgress } = useData()
  const { session: authSession } = useAuth()
  const userId = authSession?.user.id ?? ''

  // 진행 중인 세션이 있으면 이어풀기 버튼을 띄운다.
  const [openSession, setOpenSession] = useState<StudySession | null>(null)
  useEffect(() => {
    let active = true
    void fetchOpenSession()
      .then((found) => {
        if (active) setOpenSession(found)
      })
      .catch((caught: unknown) => console.error('세션을 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  // 오늘의 문제: 26학번 학년말고사 전 과목에서 매일 같은 10문제를 모두가 푼다.
  const [dailySession, setDailySession] = useState<{
    sessionId: string
    date: string
    questionIds: string[]
  } | null>(null)
  const [dailyStats, setDailyStats] = useState<DailyChallengeStats | null>(null)
  const [showDailyStats, setShowDailyStats] = useState(false)

  useEffect(() => {
    if (!userId) return
    let active = true

    async function load() {
      try {
        const session = await ensureDailySession(userId)
        if (!active) return
        setDailySession(session)

        const stats = await fetchDailyChallengeStats()
        if (active) setDailyStats(stats)
      } catch (caught) {
        console.error('오늘의 문제를 불러오지 못했습니다.', caught)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [userId])

  const today = dailySession ? dailyStats?.history.find((day) => day.date === dailySession.date) : undefined
  const dailyDone = today?.done ?? 0
  const dailyTotal = today?.total ?? dailySession?.questionIds.length ?? 10
  const dailyRemaining = Math.max(0, dailyTotal - dailyDone)

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  const subjects = taxonomy?.subjects ?? []

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">학습하기</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          과목을 선택해 단원별로 문제를 풀어보세요.
        </p>
      </header>

      {openSession && openSession.questionIds.length > 0 && (
        <Link
          to={`/solve?session=${openSession.id}`}
          className="mb-4 flex items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 p-3 transition-colors hover:border-brand-500 dark:border-brand-800 dark:bg-brand-900/30"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
            ▶
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">이어풀기</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
              {sessionScopeLabel(openSession, taxonomy) ?? SESSION_LABEL[openSession.mode] ?? '학습'},{' '}
              {openSession.currentIndex + 1} / {openSession.questionIds.length}
            </span>
          </span>
        </Link>
      )}

      {dailySession && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-900/20">
          <Link
            to={`/solve?session=${dailySession.sessionId}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
              ▶
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">오늘의 문제</span>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                {dailyRemaining === 0
                  ? '오늘의 문제를 모두 풀었습니다'
                  : `오늘의 문제가 ${dailyRemaining}개 남았습니다.`}
              </span>
            </span>
          </Link>

          <button
            type="button"
            onClick={() => setShowDailyStats(true)}
            className="h-9 shrink-0 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
          >
            현황 보기
          </button>
        </div>
      )}

      {showDailyStats && <DailyChallengeStatsModal onClose={() => setShowDailyStats(false)} />}

      {subjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 과목이 없습니다.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject, index) => {
            const progress = subjectProgress(subject.id)
            const rate = accuracy(progress)
            const unitCount = taxonomy?.units.filter((u) => u.subjectId === subject.id).length ?? 0

            return (
              <li key={subject.id}>
                <Link
                  to={`/study/${subject.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold ${
                        TILE_COLORS[index % TILE_COLORS.length]
                      }`}
                    >
                      {subject.name.slice(0, 1)}
                    </span>

                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-semibold">{subject.name}</h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        단원 {unitCount}개
                        {rate !== null && ` 정답률 ${rate}%`}
                      </p>
                    </div>

                    <ResetProgressMenu label={subject.name} scope={{ subjectId: subject.id }} />
                  </div>

                  <div className="mt-3">
                    <ProgressBar progress={progress} />
                    <p className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {progress.solved} / {progress.total} 문제
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
