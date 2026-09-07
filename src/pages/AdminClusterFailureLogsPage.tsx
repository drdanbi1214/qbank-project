import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchClusterAttachFailures,
  type ClusterAttachFailure,
} from '@/lib/queries/clusters'
import { formatDateTime } from '@/utils/date'

/** 실제 문제-문제 연결이 실패한 경우만 서버에 남긴 운영 로그. */
export function AdminClusterFailureLogsPage() {
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; rows: ClusterAttachFailure[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void fetchClusterAttachFailures()
      .then((rows) => {
        if (active) {
          setLoaded({ key: reloadKey, rows })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '실패 기록을 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const rows = loaded?.key === reloadKey ? loaded.rows : null

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">야마 묶기 실패 기록</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              문제-문제 연결이 실패한 시도와 서버 응답을 최근 순서로 확인합니다.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
            새로고침
          </Button>
        </header>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {rows === null ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">아직 기록된 실패가 없습니다.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-200">{row.actorName}</span>
                  <span>·</span>
                  <span>{formatDateTime(row.createdAt)}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                    {row.variant === 'identical' ? '완전 동일' : '유사'}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Link to={`/solve?question=${row.anchorQuestionId}`} className="text-brand-600 hover:underline dark:text-brand-300">
                    {row.anchorQuestionCode}
                  </Link>
                  <span className="text-slate-400">→</span>
                  <Link to={`/solve?question=${row.targetQuestionId}`} className="text-brand-600 hover:underline dark:text-brand-300">
                    {row.targetQuestionCode}
                  </Link>
                </div>
                <p className="mt-2 rounded bg-rose-50 px-2.5 py-2 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                  {row.errorMessage}
                  {row.errorCode && <span className="ml-2 text-xs opacity-70">({row.errorCode})</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DesktopOnly>
  )
}
