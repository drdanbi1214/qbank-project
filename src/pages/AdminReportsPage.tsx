import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fetchReports, resolveReport, type Report } from '@/lib/queries/admin'
import { formatDateTime } from '@/utils/date'
import { cn } from '@/utils/cn'

const TARGET_LABEL: Record<string, string> = {
  question: '문제',
  solution: '풀이',
  comment: '댓글',
  discussion: '게시글',
}

const STATUS_LABEL: Record<string, string> = {
  pending: '접수',
  in_progress: '처리 중',
  resolved: '완료',
}

/** 신고 처리함. 신고 대상으로 바로 이동해 확인할 수 있다. */
export function AdminReportsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; rows: Report[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  useEffect(() => {
    let active = true
    void fetchReports()
      .then((rows) => {
        if (active) {
          setLoaded({ key: reloadKey, rows })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '신고를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  async function update(id: string, status: string) {
    try {
      await resolveReport(id, status)
      setReloadKey((value) => value + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.')
    }
  }

  const ready = loaded?.key === reloadKey
  const all = ready ? loaded.rows : []
  const rows = showResolved ? all : all.filter((row) => row.status !== 'resolved')

  function linkFor(report: Report): string | null {
    switch (report.targetType) {
      case 'question':
        return `/solve?question=${report.targetId}`
      case 'discussion':
        return `/discussions?post=${report.targetId}`
      default:
        return null
    }
  }

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">신고 처리함</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              신고된 문제와 글을 확인합니다.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? '미처리만 보기' : '완료 포함'}
          </Button>
        </header>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {!ready ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">처리할 신고가 없습니다.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const link = linkFor(row)
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {TARGET_LABEL[row.targetType] ?? row.targetType}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-semibold text-white',
                        row.status === 'resolved'
                          ? 'bg-emerald-600'
                          : row.status === 'in_progress'
                            ? 'bg-amber-500'
                            : 'bg-rose-600',
                      )}
                    >
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                    <span className="text-slate-400">
                      {row.reporter?.displayName ?? '알 수 없음'} | {formatDateTime(row.createdAt)}
                    </span>
                    {link && (
                      <Link
                        to={link}
                        className="ml-auto text-brand-600 hover:underline dark:text-brand-300"
                      >
                        대상 보기
                      </Link>
                    )}
                  </div>

                  <p className="mt-1.5 whitespace-pre-wrap text-sm">
                    {row.reason ?? '사유 없음'}
                  </p>

                  <div className="mt-2 flex gap-1">
                    {row.status !== 'in_progress' && (
                      <Button size="sm" variant="secondary" onClick={() => void update(row.id, 'in_progress')}>
                        처리 중으로
                      </Button>
                    )}
                    {row.status !== 'resolved' && (
                      <Button size="sm" onClick={() => void update(row.id, 'resolved')}>
                        완료 처리
                      </Button>
                    )}
                    {row.status === 'resolved' && (
                      <Button size="sm" variant="ghost" onClick={() => void update(row.id, 'pending')}>
                        다시 열기
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </DesktopOnly>
  )
}
