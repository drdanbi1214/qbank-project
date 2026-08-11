import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Spinner } from '@/components/ui/Spinner'
import { fetchAdminStats, type AdminStats } from '@/lib/queries/admin'
import { cn } from '@/utils/cn'

/**
 * 운영 통계.
 * 차트 라이브러리를 넣지 않고 막대만 CSS 로 그린다. 값이 몇 개 안 되고
 * 번들을 키우면서까지 얻을 게 없다.
 */
export function AdminStatsPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchAdminStats()
      .then((next) => {
        if (active) setStats(next)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '통계를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [])

  const maxAttempts = Math.max(1, ...(stats?.dailyActive ?? []).map((row) => row.attempts))

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">통계</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            전체 현황과 손볼 곳을 한눈에 봅니다.
          </p>
        </header>

        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        ) : !stats ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Card label="회원" value={stats.members} sub={`승인 대기 ${stats.pendingMembers}`} />
              <Card label="최근 7일 활동" value={stats.active7d} sub="명" />
              <Card label="문제" value={stats.questions} sub={`공개 ${stats.published}`} />
              <Card label="풀이" value={stats.solutions} sub={`게시글 ${stats.discussions}`} />
            </div>

            <div>
              <h2 className="mb-2 text-base font-bold">손볼 곳</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Todo
                  label="단원 미분류"
                  value={stats.unlabeled}
                  to="/admin/labeling"
                />
                <Todo
                  label="정답 미확정"
                  value={stats.unconfirmedAnswers}
                  to="/admin/questions?flag=unconfirmed"
                />
                <Todo
                  label="복기 불완전"
                  value={stats.incomplete}
                  to="/admin/questions?flag=incomplete"
                />
                <Todo label="풀이 없는 문제" value={stats.questionsWithoutSolution} to="/admin/assignments" />
                <Todo label="미처리 신고" value={stats.openReports} to="/admin/reports" />
                <Todo
                  label="마감 지난 배정"
                  value={stats.overdueAssignments}
                  to="/admin/assignments"
                />
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-base font-bold">최근 14일 풀이량</h2>
              {stats.dailyActive.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  아직 기록이 없습니다.
                </p>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex h-40 items-end gap-1">
                    {stats.dailyActive.map((row) => (
                      <div key={row.day} className="flex flex-1 flex-col items-center gap-1">
                        <span className="text-[10px] tabular-nums text-slate-400">
                          {row.attempts}
                        </span>
                        <div
                          className="w-full rounded-t bg-brand-500"
                          style={{ height: `${(row.attempts / maxAttempts) * 100}%` }}
                          title={`${row.day} 풀이 ${row.attempts}회, ${row.users}명`}
                        />
                        <span className="text-[10px] text-slate-400">{row.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div>
              <h2 className="mb-2 text-base font-bold">정답률이 낮은 문제</h2>
              {stats.hardest.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  판단할 만큼 기록이 쌓이지 않았습니다. 문항당 3회 이상 풀리면 나타납니다.
                </p>
              ) : (
                <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                  {stats.hardest.map((row) => (
                    <li key={row.questionId}>
                      <Link
                        to={`/admin/questions?edit=${row.questionId}`}
                        className="flex items-center gap-3 px-4 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <span
                          className={cn(
                            'w-12 shrink-0 text-sm font-bold tabular-nums',
                            row.accuracy < 30
                              ? 'text-marker-red'
                              : 'text-amber-600 dark:text-amber-400',
                          )}
                        >
                          {row.accuracy}%
                        </span>
                        <span className="min-w-0 flex-1 text-sm">
                          {row.cohort} {row.subjectName} {row.questionNumber}번
                        </span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {row.attempts}회 풀림
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </DesktopOnly>
  )
}

function Card({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

function Todo({ label, value, to }: { label: string; value: number; to: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'rounded-xl border p-3 transition-colors',
        value > 0
          ? 'border-amber-300 bg-amber-50 hover:border-amber-500 dark:border-amber-800 dark:bg-amber-950/30'
          : 'border-slate-200 bg-white hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
    </Link>
  )
}
