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

  // 배정은 시험군(2026 본 2-1 계통 Y / 26학번 학년말고사)으로 크게 나눈 뒤
  // 그 안에서 과목별로 묶는다. 과목만으로 묶으면 학년말고사 내과와 계통 Y 내과가
  // 한 덩어리로 섞여 어느 시험 문항인지 구분이 안 된다.
  // 소제목은 시험별 보기와 같은 규칙으로, 계통명이 있으면 그것을 우선한다
  // (계통 Y 는 8개 시험이 전부 과목상 "내과"라 과목명으로는 나뉘지 않는다).
  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; latest: string; count: number; subjects: Map<string, { name: string; items: MyAssignment[] }> }
    >()

    for (const row of filtered) {
      const groupKey = row.curriculum ?? `${row.cohort} ${row.examName}`
      const group = groups.get(groupKey) ?? {
        label: groupKey,
        latest: '',
        count: 0,
        subjects: new Map<string, { name: string; items: MyAssignment[] }>(),
      }
      if ((row.examDate ?? '') > group.latest) group.latest = row.examDate ?? ''
      group.count += 1

      const subjectKey = row.examSubjectLabel ?? row.subjectId
      const subject = group.subjects.get(subjectKey) ?? {
        name: row.examSubjectLabel ?? row.subjectName,
        items: [],
      }
      subject.items.push(row)
      group.subjects.set(subjectKey, subject)
      groups.set(groupKey, group)
    }

    const byExamThenNumber = (a: MyAssignment, b: MyAssignment) =>
      (a.examDate ?? '').localeCompare(b.examDate ?? '') || a.questionNumber - b.questionNumber

    return [...groups.entries()]
      // 최근 시험군을 위로. 지금 작업 중인 시험이 맨 앞에 오게 한다.
      .sort(([, a], [, b]) => b.latest.localeCompare(a.latest) || a.label.localeCompare(b.label, 'ko'))
      .map(([key, group]) => {
        const subjects = [...group.subjects.entries()].map(([subjectKey, subject]) => ({
          key: subjectKey,
          name: subject.name,
          items: [...subject.items].sort(byExamThenNumber),
        }))

        // 과목으로 나뉜 묶음(학년말고사)은 rows 가 이미 과목 정렬순으로 오므로
        // 들어온 순서를 그대로 둔다. 계통명으로 나뉜 묶음(계통 Y)은 전부 같은
        // 과목이라 그 순서가 무의미하므로 시험 날짜순으로 세운다.
        if (subjects.every((subject) => subject.items[0].examSubjectLabel !== null)) {
          subjects.sort((a, b) => byExamThenNumber(a.items[0], b.items[0]))
        }

        return { key, label: group.label, count: group.count, subjects }
      })
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
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.key}>
              <h2 className="mb-3 flex items-baseline gap-2 border-b border-slate-200 pb-1.5 text-base font-bold dark:border-slate-700">
                {group.label}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  {group.count}문항
                </span>
              </h2>

              <div className="space-y-4">
          {group.subjects.map((subject) => (
            <div key={subject.key}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-bold text-slate-500 dark:text-slate-400">
                {subject.name}
                <span className="text-xs font-normal">{subject.items.length}문항</span>
              </h3>

              <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                {subject.items.map((row) => {
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
                            {/* 시험군과 과목은 위 제목이 이미 말해주므로 여기서는
                                같은 묶음 안에서 갈리는 차수만 덧붙인다. */}
                            {row.questionNumber}번 | {row.examName}
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
