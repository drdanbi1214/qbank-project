import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { fetchAccessPermissions } from '@/lib/queries/permissions'
import type { AccessPermission } from '@/lib/permissions'
import { cn } from '@/utils/cn'

export const PUBLIC_SCOPE_LABEL = '전체공개'

/**
 * 내가 풀이를 공개할 수 있는 범위 목록.
 *
 * 스터디 권한만 고른다. AI 풀이 탭 같은 기능 권한이나 학번 열람 권한으로
 * 풀이를 잠그는 것은 의미가 없기 때문이다.
 */
function useMyStudyScopes(): AccessPermission[] {
  const { permissions } = useAuth()
  const [all, setAll] = useState<AccessPermission[]>([])

  useEffect(() => {
    let active = true
    void fetchAccessPermissions()
      .then((rows) => {
        if (active) setAll(rows)
      })
      .catch((caught: unknown) => console.error('공개범위 목록을 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  return all.filter((item) => item.kind === 'study' && permissions.includes(item.key))
}

/**
 * 풀이 공개범위 선택.
 *
 * 값이 null 이면 전체공개다. 고를 수 있는 스터디가 하나도 없으면
 * 전체공개밖에 선택지가 없으므로 아예 그리지 않는다.
 */
export function SolutionScopePicker({
  value,
  onChange,
  disabled,
}: {
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
}) {
  const scopes = useMyStudyScopes()

  // 남의 풀이를 관리자가 고치는 경우처럼 지금 값이 내 목록에 없을 수 있다.
  // 그대로 두면 select 가 첫 항목으로 보여서, 손대지 않았는데 저장할 때
  // 공개범위가 바뀌어버린다. 현재 값은 항상 선택지에 넣어둔다.
  const options =
    value !== null && !scopes.some((scope) => scope.key === value)
      ? [...scopes, { key: value, name: value } as AccessPermission]
      : scopes

  if (options.length === 0) return null

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium text-slate-600 dark:text-slate-300">공개 범위</span>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
      >
        {options.map((scope) => (
          <option key={scope.key} value={scope.key}>
            {scope.name}
          </option>
        ))}
        <option value="">{PUBLIC_SCOPE_LABEL}</option>
      </select>
      <span className="text-xs text-slate-400 dark:text-slate-500">
        {value === null
          ? '이 사이트의 모든 사용자가 읽을 수 있습니다.'
          : '같은 권한을 가진 사람만 읽을 수 있습니다.'}
      </span>
    </label>
  )
}

/** 풀이 목록에서 그 풀이가 어느 범위로 공개됐는지 보여주는 뱃지. */
export function SolutionScopeBadge({ permissionKey }: { permissionKey: string | null }) {
  const [all, setAll] = useState<AccessPermission[]>([])

  useEffect(() => {
    let active = true
    void fetchAccessPermissions()
      .then((rows) => {
        if (active) setAll(rows)
      })
      .catch(() => {
        /* 이름을 못 받아도 키로 대신 보여준다 */
      })
    return () => {
      active = false
    }
  }, [])

  const isPublic = permissionKey === null
  const name = isPublic
    ? PUBLIC_SCOPE_LABEL
    : (all.find((item) => item.key === permissionKey)?.name ?? permissionKey)

  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-semibold',
        isPublic
          ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
          : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200',
      )}
    >
      {name}
    </span>
  )
}
