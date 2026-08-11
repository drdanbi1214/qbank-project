import { useCallback, useEffect, useState } from 'react'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import {
  fetchAdminQuestions,
  findSimilarQuestions,
  groupQuestions,
  ungroupQuestion,
  type AdminQuestionRow,
  type SimilarQuestion,
} from '@/lib/queries/admin'
import { cn } from '@/utils/cn'

/**
 * 중복 그룹 관리.
 *
 * 같은 문제가 여러 학번 시험에 나오는 일이 잦다. 그룹으로 묶어두면 풀이와
 * 게시글이 그룹 단위로 공유되어 같은 설명을 여러 번 쓰지 않아도 된다.
 * 후보는 본문 유사도(pg_trgm)로 찾는다.
 */
export function AdminGroupsPage() {
  const { session } = useAuth()
  const { taxonomy, refreshAll } = useData()
  const userId = session?.user.id ?? ''

  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminQuestionRow[] | null>(null)
  const [selected, setSelected] = useState<AdminQuestionRow | null>(null)
  const [candidates, setCandidates] = useState<SimilarQuestion[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [threshold, setThreshold] = useState(0.6)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    void fetchAdminQuestions({ subjectId })
      .then((next) => {
        if (active) setRows(next)
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [subjectId, reloadKey])

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      return examShortLabel(exam, exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined)
    },
    [taxonomy],
  )

  async function inspect(row: AdminQuestionRow) {
    setSelected(row)
    setCandidates(null)
    setPicked(new Set())
    setError(null)
    try {
      setCandidates(await findSimilarQuestions(row.id, threshold))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '후보를 찾지 못했습니다.')
    }
  }

  async function merge() {
    if (!selected || picked.size === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      await groupQuestions({
        questionIds: [selected.id, ...picked],
        canonicalId: selected.id,
        userId,
      })
      setPicked(new Set())
      setReloadKey((value) => value + 1)
      refreshAll()
      await inspect(selected)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '묶지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function unlink(questionId: string) {
    try {
      await ungroupQuestion(questionId)
      setReloadKey((value) => value + 1)
      if (selected) await inspect(selected)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '해제하지 못했습니다.')
    }
  }

  const selectClass =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none dark:border-slate-700 dark:bg-slate-900'

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">중복 그룹 관리</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            같은 문제가 여러 학번에 나온 경우 묶습니다. 묶으면 풀이와 게시글을 함께 씁니다.
          </p>
        </header>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="grid gap-5 xl:grid-cols-[24rem_1fr]">
          <div>
            <select
              value={subjectId ?? ''}
              onChange={(event) => setSubjectId(event.target.value || null)}
              className={`${selectClass} mb-2`}
              aria-label="과목"
            >
              <option value="">과목 전체</option>
              {(taxonomy?.subjects ?? []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>

            {rows === null ? (
              <div className="flex justify-center py-10">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (
              <ul className="max-h-[calc(100dvh-16rem)] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void inspect(row)}
                      className={cn(
                        'block w-full px-3 py-2 text-left transition-colors',
                        selected?.id === row.id
                          ? 'bg-brand-50 dark:bg-brand-900/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                      )}
                    >
                      <span className="flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300">
                        {examLabelOf(row.examId)} {row.questionNumber}번
                        {row.groupId && (
                          <span className="rounded bg-slate-100 px-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800">
                            그룹됨
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600 dark:text-slate-300">
                        {row.stemText ?? '본문 없음'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            {!selected ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 p-16 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  왼쪽에서 기준 문항을 고르세요.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-brand-300 bg-brand-50 p-3 dark:border-brand-800 dark:bg-brand-900/20">
                  <p className="text-xs font-semibold text-brand-700 dark:text-brand-300">
                    기준 문항 (대표로 지정됩니다)
                  </p>
                  <p className="mt-1 text-sm">
                    {examLabelOf(selected.examId)} {selected.questionNumber}번
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                    {selected.stemText ?? '본문 없음'}
                  </p>
                  {selected.groupId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1"
                      onClick={() => void unlink(selected.id)}
                    >
                      이 문항 그룹에서 빼기
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-sm">
                    유사도 기준
                    <input
                      type="range"
                      min={0.3}
                      max={0.95}
                      step={0.05}
                      value={threshold}
                      onChange={(event) => setThreshold(Number(event.target.value))}
                      className="mx-2 align-middle"
                    />
                    <span className="tabular-nums">{Math.round(threshold * 100)}%</span>
                  </label>
                  <Button size="sm" variant="secondary" onClick={() => void inspect(selected)}>
                    다시 찾기
                  </Button>
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => void merge()}
                    disabled={busy || picked.size === 0}
                  >
                    {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                    선택한 {picked.size}개와 묶기
                  </Button>
                </div>

                {candidates === null ? (
                  <div className="flex justify-center py-10">
                    <Spinner className="h-6 w-6" />
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    이 기준으로는 비슷한 문항을 찾지 못했습니다. 기준을 낮춰보세요.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                    {candidates.map((item) => (
                      <li key={item.questionId}>
                        <button
                          type="button"
                          onClick={() =>
                            setPicked((prev) => {
                              const next = new Set(prev)
                              if (next.has(item.questionId)) next.delete(item.questionId)
                              else next.add(item.questionId)
                              return next
                            })
                          }
                          className={cn(
                            'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                            picked.has(item.questionId)
                              ? 'bg-brand-50 dark:bg-brand-900/30'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                          )}
                        >
                          <span className="w-12 shrink-0 text-sm font-bold tabular-nums text-brand-600 dark:text-brand-300">
                            {Math.round(item.similarity * 100)}%
                          </span>
                          <span className="min-w-0 flex-1 text-sm">
                            {item.cohort} {item.subjectName} {item.questionNumber}번
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </DesktopOnly>
  )
}
