import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { fetchMyAssignments, type MyAssignment } from '@/lib/queries/assignments'
import { cn } from '@/utils/cn'

type Filter = 'open' | 'done' | 'all'

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

  const filtered = useMemo(() => {
    if (!rows) return []
    if (filter === 'all') return rows
    return filter === 'done'
      ? rows.filter((row) => row.status === 'done')
      : rows.filter((row) => row.status !== 'done')
  }, [rows, filter])

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; items: MyAssignment[] }>()
    for (const row of filtered) {
      const entry = map.get(row.subjectId) ?? { name: row.subjectName, items: [] }
      entry.items.push(row)
      map.set(row.subjectId, entry)
    }
    return [...map.entries()]
  }, [filtered])

  const openCount = rows?.filter((row) => row.status !== 'done').length ?? 0
  const doneCount = rows?.filter((row) => row.status === 'done').length ?? 0
  const today = new Date().toISOString().slice(0, 10)

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">풀이 배정</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          풀이 작성을 맡은 문항입니다. 문항을 열어 풀이를 작성하면 자동으로 완료 처리됩니다.
        </p>
      </header>

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
                        // 배정받은 문항은 풀이를 쓰러 오는 것이므로 정답과 작성창을 바로 연다.
                        to={`/solve?question=${row.questionId}&reveal=1&write=1`}
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
