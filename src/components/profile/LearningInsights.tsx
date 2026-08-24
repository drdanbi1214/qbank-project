import { useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchDailyChallengeStats,
  fetchMyLearningActivity,
  type DailyChallengeDay,
  type DailyChallengeStats,
  type LearningActivityDay,
} from '@/lib/queries/study'

const HEATMAP_WEEKS = 16
const DAY_MS = 24 * 60 * 60 * 1000

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) + amount * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

function weekday(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function todayInKorea(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function challengeLevel(day: DailyChallengeDay | undefined): 0 | 1 | 2 | 3 {
  if (!day || day.total <= 0 || day.done <= 0) return 0
  const rate = day.done / day.total
  if (rate >= 1) return 3
  if (rate >= 0.5) return 2
  return 1
}

const CHALLENGE_CELL_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: 'bg-slate-200 dark:bg-slate-700',
  1: 'bg-sky-200 dark:bg-sky-900',
  2: 'bg-blue-600 dark:bg-blue-500',
  3: 'bg-blue-950 dark:bg-blue-300',
}

function DailyChallengeHeatmap({ stats }: { stats: DailyChallengeStats }) {
  const today = todayInKorea()
  const start = addDays(today, -(weekday(today) + (HEATMAP_WEEKS - 1) * 7))
  const history = useMemo(
    () => new Map(stats.history.map((day) => [day.date, day])),
    [stats.history],
  )
  const dates = Array.from({ length: HEATMAP_WEEKS * 7 }, (_, index) =>
    addDays(start, index),
  )
  const monthLabels = Array.from({ length: HEATMAP_WEEKS }, (_, weekIndex) => {
    const weekDates = dates.slice(weekIndex * 7, weekIndex * 7 + 7)
    const firstOfMonth = weekDates.find((date) => date.endsWith('-01') && date <= today)
    if (firstOfMonth) return `${Number(firstOfMonth.slice(5, 7))}월`
    return weekIndex === 0 ? `${Number(weekDates[0].slice(5, 7))}월` : ''
  })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">오늘의 문제</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            최근 16주 동안 매일 10문제를 얼마나 완료했는지 보여줍니다.
          </p>
        </div>
        <div className="flex gap-3 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          <span>연속 <strong className="text-slate-900 dark:text-white">{stats.currentStreak}일</strong></span>
          <span>최고 <strong className="text-slate-900 dark:text-white">{stats.longestStreak}일</strong></span>
          <span>완료 <strong className="text-slate-900 dark:text-white">{stats.totalDays}일</strong></span>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[380px]">
          <div className="ml-7 grid grid-flow-col gap-1 text-center text-[10px] font-medium text-slate-500 dark:text-slate-400"
            style={{ gridTemplateColumns: `repeat(${HEATMAP_WEEKS}, 16px)` }}>
            {monthLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
          <div className="mt-1 flex gap-2">
            <div className="grid shrink-0 grid-rows-7 gap-1 text-[9px] leading-4 text-slate-400 dark:text-slate-500">
              {['일', '', '화', '', '목', '', '토'].map((label, index) => (
                <span key={`${label}-${index}`} className="h-4 w-5 text-right">{label}</span>
              ))}
            </div>
            <div
              className="grid shrink-0 grid-flow-col gap-1"
              style={{ gridTemplateRows: 'repeat(7, 16px)', gridAutoColumns: '16px' }}
            >
              {dates.map((date) => {
                const future = date > today
                const day = history.get(date)
                const rate = day && day.total > 0 ? Math.round((day.done / day.total) * 100) : 0
                return (
                  <span
                    key={date}
                    title={future ? date : `${date} · ${day?.done ?? 0}/${day?.total ?? 10}문제 (${rate}%)`}
                    aria-label={future ? undefined : `${date} 오늘의 문제 달성률 ${rate}%`}
                    className={`h-4 w-4 rounded-[3px] ${
                      future ? 'invisible' : CHALLENGE_CELL_CLASS[challengeLevel(day)]
                    } ${date === today ? 'ring-2 ring-blue-400 ring-offset-1 dark:ring-offset-slate-900' : ''}`}
                  />
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-400">
        <span>오늘의 문제 달성률</span>
        {([0, 1, 2, 3] as const).map((level) => (
          <span key={level} className="flex items-center gap-1">
            <span className={`h-3.5 w-3.5 rounded-[3px] ${CHALLENGE_CELL_CLASS[level]}`} />
            {level === 0 ? '0%' : level === 1 ? '1~49%' : level === 2 ? '50~99%' : '100%'}
          </span>
        ))}
      </div>
    </div>
  )
}

function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}시간 ${remainder}분` : `${hours}시간`
}

const ACTIVITY_SEGMENTS = [
  { key: 'question' as const, label: '문제', className: 'bg-blue-600 dark:bg-blue-500' },
  { key: 'theory' as const, label: '알렌·강의록', className: 'bg-sky-300 dark:bg-sky-600' },
  { key: 'other' as const, label: '기타', className: 'bg-slate-200 dark:bg-slate-600' },
]

function DailyUsageChart({ history }: { history: LearningActivityDay[] }) {
  const days = history.slice(-7)
  const totals = days.map((day) => day.question + day.theory + day.other)
  const maxSeconds = Math.max(10 * 60, ...totals)
  const averageSeconds = totals.reduce((sum, value) => sum + value, 0) / Math.max(days.length, 1)
  const weekSeconds = totals.reduce((sum, value) => sum + value, 0)
  const todaySeconds = totals.at(-1) ?? 0
  const maxMinutes = Math.ceil(maxSeconds / 600) * 10
  const averageBottom = 28 + (averageSeconds / maxSeconds) * 180

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">일별 이용 시간</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            탭이 보이고 활동 중인 시간만 기록하며, 2분간 입력이 없으면 멈춥니다.
          </p>
        </div>
        <div className="flex gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>오늘 <strong className="text-slate-900 dark:text-white">{durationLabel(todaySeconds)}</strong></span>
          <span>최근 7일 <strong className="text-slate-900 dark:text-white">{durationLabel(weekSeconds)}</strong></span>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex h-[180px] w-8 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          <span>{maxMinutes}</span>
          <span>{Math.round(maxMinutes / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative h-52 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-0 h-[180px] border-b border-l border-slate-300 dark:border-slate-600">
            <span className="absolute inset-x-0 top-0 border-t border-slate-200 dark:border-slate-700" />
            <span className="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-200 dark:border-slate-700" />
          </div>

          {averageSeconds > 0 && (
            <div
              className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-slate-400/80 dark:border-slate-500"
              style={{ bottom: averageBottom }}
            >
              <span className="absolute -top-4 right-0 bg-white pl-1 text-[10px] text-slate-400 dark:bg-slate-900 dark:text-slate-500">
                일평균 {durationLabel(averageSeconds)}
              </span>
            </div>
          )}

          <div className="absolute inset-x-0 top-0 grid h-[180px] grid-cols-7 items-end gap-2 px-1 sm:gap-4 sm:px-3">
            {days.map((day) => (
              <div key={day.date} className="flex h-full min-w-0 flex-col-reverse justify-start overflow-hidden rounded-t-sm">
                {ACTIVITY_SEGMENTS.map((segment) => {
                  const seconds = day[segment.key]
                  return (
                    <span
                      key={segment.key}
                      title={`${day.date} ${segment.label} ${durationLabel(seconds)}`}
                      className={`mx-auto w-full max-w-10 ${segment.className}`}
                      style={{
                        height: `${(seconds / maxSeconds) * 100}%`,
                        minHeight: seconds > 0 ? 2 : 0,
                      }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 grid h-6 grid-cols-7 gap-2 px-1 text-center text-[10px] tabular-nums text-slate-500 dark:text-slate-400 sm:gap-4 sm:px-3">
            {days.map((day) => <span key={day.date}>{day.date.slice(5).replace('-', '.')}</span>)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap justify-end gap-3 text-[11px] text-slate-500 dark:text-slate-400">
        {ACTIVITY_SEGMENTS.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1">
            <span className={`h-2.5 w-4 ${segment.className}`} />
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function LearningInsights() {
  const [daily, setDaily] = useState<DailyChallengeStats | null>(null)
  const [activity, setActivity] = useState<LearningActivityDay[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    Promise.all([fetchDailyChallengeStats(), fetchMyLearningActivity()])
      .then(([dailyStats, activityHistory]) => {
        if (!active) return
        setDaily(dailyStats)
        setActivity(activityHistory)
      })
      .catch((caught: unknown) => {
        console.error('학습 활동을 불러오지 못했습니다.', caught)
        if (active) setError('학습 활동을 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [])

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
        {error}
      </div>
    )
  }
  if (!daily || !activity) {
    return (
      <div className="flex justify-center rounded-xl border border-slate-200 bg-white py-12 dark:border-slate-700 dark:bg-slate-900">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
        <DailyChallengeHeatmap stats={daily} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
        <DailyUsageChart history={activity} />
      </div>
    </div>
  )
}
