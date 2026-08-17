import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { fetchDailyChallengeStats, type DailyChallengeDay } from '@/lib/queries/study'

type Props = {
  onClose: () => void
}

const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

/** 0(안 풂) ~ 3(10문제 완료) 4단계로 나눈다. */
function levelOf(day: DailyChallengeDay): 0 | 1 | 2 | 3 {
  if (day.done <= 0) return 0
  if (day.done >= day.total) return 3
  if (day.done >= day.total * 0.7) return 2
  return 1
}

const LEVEL_CLASS: Record<0 | 1 | 2 | 3, string> = {
  0: 'bg-slate-100 dark:bg-slate-800',
  1: 'bg-emerald-200 dark:bg-emerald-900/70',
  2: 'bg-emerald-400 dark:bg-emerald-700',
  3: 'bg-emerald-600 dark:bg-emerald-500',
}

/** 첫 날이 월요일 열에 오도록 앞쪽에 빈 칸을 채운다. */
function padToMonday(history: DailyChallengeDay[]): (DailyChallengeDay | null)[] {
  if (history.length === 0) return []
  const first = new Date(`${history[0].date}T00:00:00`)
  const firstWeekday = (first.getDay() + 6) % 7 // 0=월 ~ 6=일
  const padding: null[] = Array.from({ length: firstWeekday }, () => null)
  return [...padding, ...history]
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={
          accent
            ? 'mt-0.5 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400'
            : 'mt-0.5 text-lg font-bold tabular-nums'
        }
      >
        {value}
      </p>
    </div>
  )
}

export function DailyChallengeStatsModal({ onClose }: Props) {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof fetchDailyChallengeStats>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchDailyChallengeStats()
      .then((result) => {
        if (active) setStats(result)
      })
      .catch((caught: unknown) => {
        console.error('오늘의 문제 현황을 불러오지 못했습니다.', caught)
        if (active) setError('현황을 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [])

  const history = stats?.history ?? []
  const cells = padToMonday(history)
  const todayDate = history.at(-1)?.date ?? null

  const thisMonth = todayDate?.slice(0, 7) ?? null
  const monthDays = thisMonth ? history.filter((day) => day.date.startsWith(thisMonth)) : []
  const monthDone = monthDays.filter((day) => day.done >= day.total).length

  return (
    <Modal title="오늘의 문제 현황" onClose={onClose}>
      {error ? (
        <p className="py-8 text-center text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : !stats ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="연속 성공" value={`${stats.currentStreak}일`} accent />
            <Stat label="최고 기록" value={`${stats.longestStreak}일`} />
            <Stat label="총 성공" value={`${stats.totalDays}일`} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>최근 활동</span>
              <span className="flex items-center gap-1">
                적음
                <span className="flex gap-0.5">
                  {([0, 1, 2, 3] as const).map((level) => (
                    <span key={level} className={`h-2.5 w-2.5 rounded-sm ${LEVEL_CLASS[level]}`} />
                  ))}
                </span>
                많음
              </span>
            </div>

            {cells.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                아직 기록이 없습니다. 오늘의 문제를 풀면 여기에 표시됩니다.
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                <div className="flex shrink-0 flex-col justify-between py-px text-[10px] text-slate-400 dark:text-slate-500">
                  {WEEKDAY_LABELS.filter((_, i) => i % 2 === 0).map((label) => (
                    <span key={label} className="h-[11px] leading-[11px]">
                      {label}
                    </span>
                  ))}
                </div>
                <div
                  className="grid shrink-0 grid-flow-col gap-[3px]"
                  style={{ gridTemplateRows: 'repeat(7, 11px)' }}
                >
                  {cells.map((day, index) =>
                    day === null ? (
                      <span key={`pad-${index}`} className="h-[11px] w-[11px]" />
                    ) : (
                      <span
                        key={day.date}
                        title={`${day.date} · ${day.done}/${day.total}문제`}
                        className={`h-[11px] w-[11px] rounded-[3px] ${LEVEL_CLASS[levelOf(day)]} ${
                          day.date === todayDate ? 'ring-2 ring-brand-500' : ''
                        }`}
                      />
                    ),
                  )}
                </div>
              </div>
            )}
          </div>

          {thisMonth && monthDays.length > 0 && (
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
              이번 달은 <strong className="font-semibold text-slate-900 dark:text-white">{monthDays.length}일 중{' '}
              {monthDone}일</strong> 성공했어요.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
