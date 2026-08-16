import { useEffect, useState } from 'react'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  fetchMembers,
  setPermission,
  setRole,
  setSuspended,
  type Member,
} from '@/lib/queries/admin'
import { fetchAccessPermissions } from '@/lib/queries/permissions'
import { PERMISSION_KIND_LABEL, type AccessPermission } from '@/lib/permissions'
import { formatShortDate, formatRelative } from '@/utils/date'
import { cn } from '@/utils/cn'

/**
 * 사용자 관리.
 *
 * 가입 직후에는 is_suspended 가 true 라 아무것도 쓸 수 없다.
 * 여기서 승인해야 실제로 활동할 수 있다.
 */
export function AdminUsersPage() {
  const { session, refreshProfile } = useAuth()
  const myId = session?.user.id ?? ''

  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: number; rows: Member[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // 권한 목록은 DB 에 있다. 스터디 그룹이나 학번 권한이 늘어나면 여기에 그대로 나온다.
  const [permissionList, setPermissionList] = useState<AccessPermission[]>([])

  useEffect(() => {
    let active = true
    void fetchMembers()
      .then((rows) => {
        if (active) {
          setLoaded({ key: reloadKey, rows })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '사용자를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  useEffect(() => {
    let active = true
    void fetchAccessPermissions()
      .then((rows) => {
        if (active) setPermissionList(rows)
      })
      .catch((caught: unknown) => console.error('권한 목록을 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setError(null)
    try {
      await action()
      setReloadKey((value) => value + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.')
    } finally {
      setBusyId(null)
    }
  }

  const ready = loaded?.key === reloadKey
  const rows = ready ? loaded.rows : []
  const waiting = rows.filter((row) => row.isSuspended)

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">사용자 관리</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            가입 승인과 운영자 역할, 콘텐츠별 열람 권한을 각각 관리합니다.
          </p>
        </header>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {waiting.length > 0 && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
            승인 대기 {waiting.length}명. 승인 전에는 글을 쓸 수 없습니다.
          </p>
        )}

        {!ready ? (
          <div className="flex justify-center py-16">
            <Spinner className="h-7 w-7" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <table className="w-full min-w-max text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">사용자</th>
                  <th className="px-3 py-2 text-left font-medium">가입</th>
                  <th className="px-3 py-2 text-right font-medium">푼 문제</th>
                  <th className="px-3 py-2 text-right font-medium">풀이</th>
                  <th className="px-3 py-2 text-left font-medium">최근 활동</th>
                  <th className="px-3 py-2 text-left font-medium">상태</th>
                  <th className="px-3 py-2 text-left font-medium">콘텐츠 권한</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((row) => (
                  <tr key={row.id} className={cn(row.isSuspended && 'bg-amber-50/50 dark:bg-amber-950/20')}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Avatar path={row.avatarUrl} name={row.displayName} size={28} />
                        <div className="min-w-0">
                          <p className="font-medium">{row.displayName}</p>
                          <p className="truncate text-xs text-slate-400">{row.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {formatShortDate(row.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.attemptCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.solutionCount}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {row.lastActiveAt ? formatRelative(row.lastActiveAt) : '없음'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        {row.role === 'admin' && (
                          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">
                            관리자
                          </span>
                        )}
                        {row.isSuspended && (
                          <span className="rounded bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                            정지
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        {permissionList.map((permission) => (
                          <PermissionCheckbox
                            key={permission.key}
                            permission={permission}
                            checked={row.permissions.includes(permission.key)}
                            disabled={busyId === row.id}
                            onChange={(enabled) =>
                              void run(row.id, async () => {
                                await setPermission(row.id, permission.key, enabled)
                                if (row.id === myId) await refreshProfile()
                              })
                            }
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant={row.isSuspended ? 'primary' : 'ghost'}
                          disabled={busyId === row.id || row.id === myId}
                          onClick={() =>
                            void run(row.id, () => setSuspended(row.id, !row.isSuspended))
                          }
                        >
                          {row.isSuspended ? '승인' : '정지'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === row.id || row.id === myId}
                          onClick={() =>
                            void run(row.id, () =>
                              setRole(row.id, row.role === 'admin' ? 'member' : 'admin'),
                            )
                          }
                        >
                          {row.role === 'admin' ? '권한 회수' : '관리자로'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          본인 계정은 실수로 잠기지 않도록 정지와 관리자 역할 변경만 막아두었습니다.
        </p>
      </section>
    </DesktopOnly>
  )
}

function PermissionCheckbox({
  permission,
  checked,
  disabled,
  onChange,
}: {
  permission: AccessPermission
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      title={permission.description ?? undefined}
      className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs"
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-brand-600"
      />
      <span>{permission.name}</span>
      {permission.kind !== 'feature' && (
        <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {PERMISSION_KIND_LABEL[permission.kind]}
        </span>
      )}
    </label>
  )
}
