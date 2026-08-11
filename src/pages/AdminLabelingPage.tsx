import { useCallback, useEffect, useMemo, useState } from 'react'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { assignUnit, fetchAdminQuestions, type AdminQuestionRow } from '@/lib/queries/admin'
import { cn } from '@/utils/cn'

/**
 * 단원 라벨링 대기 큐.
 *
 * 단원이 비어 있는 문항만 모아 여러 개를 한 번에 같은 단원으로 넣는다.
 * 문항을 하나씩 열어 고치는 것보다 훨씬 빠르다.
 */
export function AdminLabelingPage() {
  const { taxonomy, refreshProgress } = useData()

  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; rows: AdminQuestionRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [targetUnit, setTargetUnit] = useState('')
  const [busy, setBusy] = useState(false)

  const requestKey = `${subjectId ?? ''}|${reloadKey}`

  useEffect(() => {
    let active = true
    void fetchAdminQuestions({ subjectId, unlabeledOnly: true })
      .then((rows) => {
        if (active) {
          setLoaded({ key: requestKey, rows })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [subjectId, requestKey])

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      return examShortLabel(exam, exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined)
    },
    [taxonomy],
  )

  const units = useMemo(
    () => (taxonomy?.units ?? []).filter((unit) => !subjectId || unit.subjectId === subjectId),
    [taxonomy, subjectId],
  )

  const ready = loaded?.key === requestKey
  const rows = ready ? loaded.rows : []

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function apply() {
    if (picked.size === 0 || targetUnit === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await assignUnit([...picked], targetUnit)
      setPicked(new Set())
      setReloadKey((value) => value + 1)
      refreshProgress()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '단원을 넣지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const selectClass =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none dark:border-slate-700 dark:bg-slate-900'

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">단원 라벨링</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            단원이 비어 있는 문항입니다. 여러 개를 골라 한 번에 넣을 수 있습니다.
          </p>
        </header>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            value={subjectId ?? ''}
            onChange={(event) => {
              setSubjectId(event.target.value || null)
              setPicked(new Set())
              setTargetUnit('')
            }}
            className={selectClass}
            aria-label="과목"
          >
            <option value="">과목 전체</option>
            {(taxonomy?.subjects ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>

          <span className="text-sm text-slate-500 dark:text-slate-400">
            {picked.size}개 선택
          </span>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPicked(new Set(rows.map((row) => row.id)))}
            disabled={rows.length === 0}
          >
            전체 선택
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPicked(new Set())}
            disabled={picked.size === 0}
          >
            해제
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <select
              value={targetUnit}
              onChange={(event) => setTargetUnit(event.target.value)}
              className={selectClass}
              aria-label="넣을 단원"
            >
              <option value="">단원 선택</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {taxonomy?.subjectById.get(unit.subjectId)?.name} / {unit.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={() => void apply()}
              disabled={busy || picked.size === 0 || targetUnit === ''}
            >
              {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
              적용
            </Button>
          </div>
        </div>

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
            <p className="text-sm text-slate-500 dark:text-slate-400">
              분류할 문항이 없습니다.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => toggle(row.id)}
                  className={cn(
                    'flex w-full items-start gap-3 px-3 py-2 text-left transition-colors',
                    picked.has(row.id)
                      ? 'bg-brand-50 dark:bg-brand-900/30'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                  )}
                >
                  <span
                    className={cn(
                      'mt-1 grid h-4 w-4 shrink-0 place-items-center rounded border-2',
                      picked.has(row.id)
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-300 dark:border-slate-600',
                    )}
                  >
                    {picked.has(row.id) && (
                      <svg viewBox="0 0 24 24" fill="none" className="h-2.5 w-2.5">
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="4"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-brand-600 dark:text-brand-300">
                      {examLabelOf(row.examId)} {row.questionNumber}번
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600 dark:text-slate-300">
                      {row.stemText ?? '본문 없음'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </DesktopOnly>
  )
}
