import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { fetchMyAssignments, type MyAssignment } from '@/lib/queries/assignments'
import { fetchAccessPermissions } from '@/lib/queries/permissions'
import { cn } from '@/utils/cn'

type Filter = 'open' | 'done' | 'all'
/** 스코프 탭 값. null 은 "특정 스터디에 매이지 않은 배정" 묶음이다. */
type ScopeFilter = 'all' | string | null

const STATUS_LABEL: Record<string, string> = {
  pending: '대기',
  in_progress: '작성 중',
  done: '완료',
}

/**
 * 나에게 배정된 문항만 모아 과목별로 보여준다.
 * 여기서 바로 해당 문제로 이동해 풀이를 작성한다.
 */
export function MyAssignmentsPage() {
  const [rows, setRows] = useState<MyAssignment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [scopeNames, setScopeNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    let active = true
    void fetchMyAssignments()
      .then((next) => {
        if (active) setRows(next)
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '배정을 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void fetchAccessPermissions()
      .then((permissions) => {
        if (active) setScopeNames(new Map(permissions.map((row) => [row.key, row.name])))
      })
      .catch((caught: unknown) => console.error('공개범위 목록을 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  // 한 사람이 합본3, 클로버처럼 여러 스터디에서 동시에 배정받을 수 있어
  // 배정 목록에 실제로 나타나는 범위만 탭으로 보여준다.
  const scopes = useMemo(() => {
    if (!rows) return []
    const keys = new Set(rows.map((row) => row.requiredPermission))
    return [...keys].sort((a, b) => (a ?? '').localeCompare(b ?? ''))
  }, [rows])

  const byScope = useMemo(() => {
    if (!rows) return []
    if (scopeFilter === 'all') return rows
    return rows.filter((row) => row.requiredPermission === scopeFilter)
  }, [rows, scopeFilter])

  const filtered = useMemo(() => {
    if (filter === 'all') return byScope
    return filter === 'done'
      ? byScope.filter((row) => row.status === 'done')
      : byScope.filter((row) => row.status !== 'done')
  }, [byScope, filter])

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; items: MyAssignment[] }>()
    for (const row of filtered) {
      const entry = map.get(row.subjectId) ?? { name: row.subjectName, items: [] }
      entry.items.push(row)
      map.set(row.subjectId, entry)
    }
    return [...map.entries()]
  }, [filtered])

  const openCount = byScope.filter((row) => row.status !== 'done').length
  const doneCount = byScope.filter((row) => row.status === 'done').length
  const today = new Date().toISOString().slice(0, 10)

  function scopeLabel(key: string | null): string {
    if (key === null) return '미지정'
    return scopeNames.get(key) ?? key
  }

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">풀이 배정</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          풀이 작성을 맡은 문항입니다. 문항을 열어 풀이를 작성하면 자동으로 완료 처리됩니다.
        </p>
      </header>

      {scopes.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setScopeFilter('all')}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              scopeFilter === 'all'
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400',
            )}
          >
            전체
          </button>
          {scopes.map((key) => (
            <button
              key={key ?? '__none__'}
              type="button"
              onClick={() => setScopeFilter(key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                scopeFilter === key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                  : 'text-slate-500 dark:text-slate-400',
              )}
            >
              {scopeLabel(key)}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
        {(
          [
            ['open', `남은 문항 ${openCount}`],
            ['done', `완료 ${doneCount}`],
            ['all', '전체'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'flex-1 rounded-md py-2 text-sm font-medium transition-colors',
              filter === value
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                : 'text-slate-500 dark:text-slate-400',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filter === 'done' ? '완료한 배정이 없습니다.' : '배정된 문항이 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([subjectId, group]) => (
            <div key={subjectId}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                {group.name}
                <span className="text-xs font-normal">{group.items.length}문항</span>
              </h2>

              <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                {group.items.map((row) => {
                  const overdue =
                    row.status !== 'done' && row.dueDate !== null && row.dueDate < today

                  return (
                    <li key={row.assignmentId}>
                      <Link
                        // 미작성 문항만 작성창을 연다. 이미 저장한 문항을 write=1로
                        // 다시 열면 빈 새 작성창이 보여 저장이 안 된 것으로 오해하고
                        // 같은 풀이를 중복 등록할 수 있다.
                        to={
                          row.hasMySolution
                            ? `/solve?question=${row.questionId}&reveal=1`
                            : `/solve?question=${row.questionId}&reveal=1&write=1`
                        }
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <span
                          className={cn(
                            'mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold',
                            row.status === 'done'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                          )}
                        >
                          {STATUS_LABEL[row.status] ?? row.status}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {row.stemPreview || '본문 없음'}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                            {row.questionNumber}번 [{row.cohort} {row.subjectName}]
                            {row.unitName ? ` | ${row.unitName}` : ' | 미분류'}
                            {row.questionType === 'essay' && ' | 서술형'}
                            {row.questionType === 'R' && ' | R형'}
                            {scopeFilter === 'all' &&
                              scopes.length > 1 &&
                              ` | ${scopeLabel(row.requiredPermission)}`}
                            {row.dueDate && (
                              <span className={overdue ? ' font-semibold text-rose-600' : ''}>
                                {' '}
                                | 마감 {row.dueDate}
                                {overdue && ' (지남)'}
                              </span>
                            )}
                          </span>
                        </span>

                        <span className="shrink-0 self-center text-xs font-medium text-brand-600 dark:text-brand-300">
                          {row.hasMySolution ? '풀이 보기' : '풀이 작성'}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
        문항을 선택하면 정답이 공개된 상태로 열립니다. 편집자 답을 체크하고 풀이를
        등록하면 배정이 자동으로 완료 처리됩니다.
      </p>
    </section>
  )
}
