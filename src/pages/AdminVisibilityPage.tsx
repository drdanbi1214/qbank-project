import { useCallback, useEffect, useState } from 'react'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { PERMISSION_KIND_LABEL, type AccessPermission } from '@/lib/permissions'
import {
  createPermission,
  fetchAdminExams,
  fetchAllPermissions,
  setExamStatus,
  setCohortPermission,
  setExamPermission,
  updatePermission,
  type AdminExam,
} from '@/lib/queries/visibility'
import { cn } from '@/utils/cn'

const PUBLIC_LABEL = '전체공개'

/**
 * 공개 범위 관리.
 *
 * 문제는 시험 단위로 잠근다. 시험의 공개범위가 null 이면 전체공개고,
 * 값이 있으면 그 권한을 가진 사람만 그 시험의 문제를 본다.
 * 사람별로 권한을 켜고 끄는 것은 사용자 관리 화면에서 한다.
 */
export function AdminVisibilityPage() {
  const { refreshProfile } = useAuth()
  const [exams, setExams] = useState<AdminExam[] | null>(null)
  const [permissions, setPermissions] = useState<AccessPermission[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void Promise.all([fetchAdminExams(), fetchAllPermissions()])
      .then(([examRows, permissionRows]) => {
        if (!active) return
        setExams(examRows)
        setPermissions(permissionRows)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  const run = useCallback(
    async (token: string, action: () => Promise<void>) => {
      setBusy(token)
      setError(null)
      try {
        await action()
        // 내 권한이 바뀌었을 수도 있으니 프로필을 다시 읽는다.
        await refreshProfile()
        setReloadKey((value) => value + 1)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '처리하지 못했습니다.')
      } finally {
        setBusy(null)
      }
    },
    [refreshProfile],
  )

  // 학번별로 묶어서 보여준다. 잠금은 대체로 학번 단위로 건다.
  const cohorts = [...new Set((exams ?? []).map((exam) => exam.cohort))].sort()

  return (
    <DesktopOnly>
      <section className="space-y-8">
        <header>
          <h1 className="text-lg font-bold">공개 범위 관리</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            전체공개인 시험은 모든 사용자가 봅니다. 권한을 걸면 그 권한을 가진 사람만 그 시험의
            문제를 볼 수 있고, 문제 수·진도율·검색·게시판에서도 함께 빠집니다.
          </p>
        </header>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        {exams === null ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-5 w-5" />
          </div>
        ) : (
          cohorts.map((cohort) => {
            const rows = exams.filter((exam) => exam.cohort === cohort)
            const current = rows[0]?.requiredPermission ?? null
            const mixed = rows.some((exam) => exam.requiredPermission !== current)

            return (
              <div key={cohort} className="rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <h2 className="font-bold">{cohort}</h2>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    시험 {rows.length}개 · 문제{' '}
                    {rows.reduce((sum, exam) => sum + exam.questionCount, 0)}개
                  </span>
                  {mixed && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200">
                      시험마다 다름
                    </span>
                  )}
                  <label className="ml-auto flex items-center gap-2 text-sm">
                    <span className="text-slate-500 dark:text-slate-400">학번 전체를</span>
                    <ScopeSelect
                      value={mixed ? '' : current}
                      permissions={permissions}
                      disabled={busy !== null}
                      placeholder={mixed ? '— 일괄 변경 —' : undefined}
                      onChange={(next) =>
                        void run(`cohort:${cohort}`, () => setCohortPermission(cohort, next))
                      }
                    />
                    {busy === `cohort:${cohort}` && <Spinner className="h-4 w-4" />}
                  </label>
                </div>

                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((exam) => (
                      <tr
                        key={exam.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                      >
                        <td className="px-4 py-2 font-medium">{exam.subjectName}</td>
                        <td className="px-4 py-2 text-slate-500 dark:text-slate-400">
                          {exam.examName}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-400">
                          {exam.questionCount}문제
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant={exam.status === 'published' ? 'secondary' : 'ghost'}
                            disabled={busy !== null}
                            onClick={() =>
                              void run(`status:${exam.id}`, () =>
                                setExamStatus(exam.id, exam.status === 'published' ? 'draft' : 'published'),
                              )
                            }
                          >
                            {exam.status === 'published' ? '공개됨' : '작업 중'}
                          </Button>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {busy === exam.id && <Spinner className="h-4 w-4" />}
                            <ScopeSelect
                              value={exam.requiredPermission}
                              permissions={permissions}
                              disabled={busy !== null}
                              onChange={(next) =>
                                void run(exam.id, () => setExamPermission(exam.id, next))
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })
        )}

        <PermissionManager
          permissions={permissions}
          disabled={busy !== null}
          onCreate={(params) => void run('create', () => createPermission(params))}
          onRename={(key, patch) => void run(`perm:${key}`, () => updatePermission(key, patch))}
        />
      </section>
    </DesktopOnly>
  )
}

/** 전체공개(null) + 모든 권한 중 하나를 고른다. */
function ScopeSelect({
  value,
  permissions,
  disabled,
  placeholder,
  onChange,
}: {
  value: string | null
  permissions: AccessPermission[]
  disabled: boolean
  placeholder?: string
  onChange: (next: string | null) => void
}) {
  return (
    <select
      value={value ?? (placeholder ? '' : '__public__')}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value
        if (raw === '') return
        onChange(raw === '__public__' ? null : raw)
      }}
      className={cn(
        'rounded-lg border px-2 py-1 text-sm outline-none focus:border-brand-500 disabled:opacity-50',
        value === null
          ? 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900'
          : 'border-indigo-300 bg-indigo-50 font-medium text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200',
      )}
    >
      {placeholder && <option value="">{placeholder}</option>}
      <option value="__public__">{PUBLIC_LABEL}</option>
      {permissions.map((permission) => (
        <option key={permission.key} value={permission.key}>
          {permission.name}
        </option>
      ))}
    </select>
  )
}

/**
 * 권한 목록 관리.
 *
 * 지우기는 없다. 이미 그 권한으로 쓴 풀이나 잠긴 시험이 있으면 외래키에
 * 막히는데 화면에서 설명하기 애매하고, 안 쓰는 권한은 남겨둬도 해가 없다.
 */
function PermissionManager({
  permissions,
  disabled,
  onCreate,
  onRename,
}: {
  permissions: AccessPermission[]
  disabled: boolean
  onCreate: (params: {
    key: string
    name: string
    description: string | null
    kind: 'study'
    sortOrder: number
  }) => void
  onRename: (key: string, patch: { name: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const keyPattern = /^[a-z][a-z0-9_]*$/
  const keyTaken = permissions.some((permission) => permission.key === key.trim())
  const keyValid = keyPattern.test(key.trim()) && !keyTaken
  const canSubmit = keyValid && name.trim() !== ''

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h2 className="font-bold">권한 · 스터디 그룹</h2>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          여기서 만든 스터디는 풀이 작성 화면의 공개범위 선택지에 바로 나옵니다.
        </span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(!open)}>
          {open ? '닫기' : '스터디 추가'}
        </Button>
      </div>

      {open && (
        <div className="space-y-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/40">
          <div className="flex flex-wrap gap-2">
            <input
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder="키 (영문소문자_숫자)"
              className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
            />
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="표시 이름 (예: 합본4 스터디)"
              className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="설명 (선택)"
              className="min-w-64 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
            />
            <Button
              size="sm"
              disabled={!canSubmit || disabled}
              onClick={() => {
                onCreate({
                  key: key.trim(),
                  name: name.trim(),
                  description: description.trim() || null,
                  kind: 'study',
                  sortOrder: 100 + permissions.length,
                })
                setKey('')
                setName('')
                setDescription('')
                setOpen(false)
              }}
            >
              추가
            </Button>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {keyTaken
              ? '이미 있는 키입니다.'
              : key.trim() !== '' && !keyPattern.test(key.trim())
                ? '키는 영문 소문자로 시작하고 소문자·숫자·밑줄만 씁니다. 나중에 바꿀 수 없습니다.'
                : '키는 나중에 바꿀 수 없습니다. 표시 이름은 언제든 고칠 수 있습니다.'}
          </p>
        </div>
      )}

      <table className="w-full text-sm">
        <tbody>
          {permissions.map((permission) => (
            <PermissionRow
              key={permission.key}
              permission={permission}
              disabled={disabled}
              onRename={onRename}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PermissionRow({
  permission,
  disabled,
  onRename,
}: {
  permission: AccessPermission
  disabled: boolean
  onRename: (key: string, patch: { name: string }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(permission.name)

  return (
    <tr className="border-b border-slate-100 last:border-0 dark:border-slate-800">
      <td className="px-4 py-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {PERMISSION_KIND_LABEL[permission.kind]}
        </span>
      </td>
      <td className="px-4 py-2 font-medium">
        {editing ? (
          <input
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            className="w-56 rounded border border-slate-300 px-2 py-0.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
          />
        ) : (
          permission.name
        )}
      </td>
      <td className="px-4 py-2 font-mono text-xs text-slate-400 dark:text-slate-500">
        {permission.key}
      </td>
      <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{permission.description}</td>
      <td className="px-4 py-2 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              disabled={disabled || draft.trim() === ''}
              onClick={() => {
                onRename(permission.key, { name: draft.trim() })
                setEditing(false)
              }}
            >
              저장
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(permission.name)
                setEditing(false)
              }}
            >
              취소
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setEditing(true)}>
            이름 변경
          </Button>
        )}
      </td>
    </tr>
  )
}
