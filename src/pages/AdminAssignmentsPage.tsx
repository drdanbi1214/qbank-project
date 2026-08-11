import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { DesktopOnly } from '@/components/DesktopOnly'
import {
  assignQuestions,
  fetchAssignmentProgress,
  type AssignmentProgress,
} from '@/lib/queries/assignments'
import { fetchMembers, type Member } from '@/lib/queries/profiles'
import { fetchQuestions, type SolveQuestion } from '@/lib/queries/questions'
import { examTitle } from '@/lib/queries/taxonomy'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

/**
 * 배정 관리. 시험을 고르고 문항을 선택해 담당자에게 넘긴다.
 * 담당자는 `풀이 배정` 탭에서 자기 몫만 본다.
 */
export function AdminAssignmentsPage() {
  const { session } = useAuth()
  const { taxonomy } = useData()

  const [examId, setExamId] = useState('')
  const [questions, setQuestions] = useState<SolveQuestion[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [members, setMembers] = useState<Member[]>([])
  const [assigneeId, setAssigneeId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [progress, setProgress] = useState<AssignmentProgress[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [progressNonce, setProgressNonce] = useState(0)

  useEffect(() => {
    let active = true
    void fetchMembers()
      .then((rows) => {
        if (active) setMembers(rows)
      })
      .catch((error: unknown) => console.error('사용자를 불러오지 못했습니다.', error))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void fetchAssignmentProgress()
      .then((rows) => {
        if (active) setProgress(rows)
      })
      .catch((error: unknown) => console.error('진행률을 불러오지 못했습니다.', error))
    return () => {
      active = false
    }
  }, [progressNonce])

  useEffect(() => {
    if (!examId) return
    let active = true
    void fetchQuestions({ examId })
      .then((rows) => {
        if (active) setQuestions(rows)
      })
      .catch((error: unknown) => console.error('문항을 불러오지 못했습니다.', error))
    return () => {
      active = false
    }
  }, [examId])

  const shown = examId ? questions : null

  const exams = useMemo(() => taxonomy?.exams ?? [], [taxonomy])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    const userId = session?.user.id
    if (!userId || !assigneeId || selected.size === 0) return

    setBusy(true)
    setMessage(null)
    try {
      const created = await assignQuestions({
        questionIds: [...selected],
        assigneeId,
        assignedBy: userId,
        dueDate: dueDate || null,
      })
      const skipped = selected.size - created
      setMessage(
        `${created}문항을 배정했습니다.` +
          (skipped > 0 ? ` (이미 배정된 ${skipped}문항은 건너뛰었습니다)` : ''),
      )
      setSelected(new Set())
      setProgressNonce((n) => n + 1)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '배정에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900'

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4">
          <h1 className="text-xl font-bold">배정 관리</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            시험을 고르고 문항을 선택해 담당자에게 배정합니다.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">시험</span>
            <select
              value={examId}
              onChange={(event) => {
                setExamId(event.target.value)
                setSelected(new Set())
              }}
              className={inputClass}
            >
              <option value="">선택하세요</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {examTitle(exam, taxonomy?.subjectById.get(exam.subjectId)?.name)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">담당자</span>
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className={inputClass}
            >
              <option value="">선택하세요</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                  {member.cohort ? ` (${member.cohort})` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">마감일</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={inputClass}
            />
          </label>

          <Button
            onClick={() => void submit()}
            disabled={busy || !assigneeId || selected.size === 0}
          >
            {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            {selected.size}문항 배정
          </Button>
        </div>

        {message && (
          <p className="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
            {message}
          </p>
        )}

        {shown === null ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              시험을 선택하면 문항이 표시됩니다.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => setSelected(new Set(shown.map((q) => q.id)))}
                className="text-brand-600 hover:underline dark:text-brand-300"
              >
                전체 선택
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-slate-500 hover:underline dark:text-slate-400"
              >
                선택 해제
              </button>
            </div>

            <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
              {shown.map((question) => (
                <li key={question.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800',
                      selected.has(question.id) && 'bg-brand-50/60 dark:bg-brand-900/20',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(question.id)}
                      onChange={() => toggle(question.id)}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">
                        {question.stemBlocks.find((b) => b.type === 'text')?.content ??
                          '본문 없음'}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        {question.questionNumber}번
                        {question.unitId
                          ? ` | ${taxonomy?.unitById.get(question.unitId)?.name ?? ''}`
                          : ' | 미분류'}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="mb-2 mt-8 text-sm font-bold text-slate-500 dark:text-slate-400">
          담당자별 진행률
        </h2>
        {progress.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">아직 배정이 없습니다.</p>
          </div>
        ) : (
          <table className="w-full overflow-hidden rounded-xl border border-slate-200 text-sm dark:border-slate-700">
            <thead className="bg-slate-100 text-left dark:bg-slate-800">
              <tr>
                <th className="px-4 py-2 font-semibold">담당자</th>
                <th className="px-4 py-2 font-semibold">완료</th>
                <th className="px-4 py-2 font-semibold">전체</th>
                <th className="px-4 py-2 font-semibold">마감 지남</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-slate-900">
              {progress.map((row) => (
                <tr key={row.assigneeId} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="px-4 py-2">{row.displayName}</td>
                  <td className="px-4 py-2 tabular-nums">{row.done}</td>
                  <td className="px-4 py-2 tabular-nums">{row.total}</td>
                  <td
                    className={cn(
                      'px-4 py-2 tabular-nums',
                      row.overdue > 0 && 'font-semibold text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {row.overdue}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </DesktopOnly>
  )
}
