import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ProgressBadge } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchQuestionStates,
  fetchQuestions,
  type QuestionState,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { examYearLabel } from '@/lib/queries/taxonomy'
import { useData, type Progress } from '@/lib/data'

const UNLABELED = 'unlabeled'

type ExamGroup = {
  examId: string
  label: string
  progress: Progress
}

function groupByExam(
  questions: SolveQuestion[],
  states: Map<string, QuestionState>,
  labelOf: (examId: string) => string,
): ExamGroup[] {
  const byExam = new Map<string, SolveQuestion[]>()
  for (const question of questions) {
    const list = byExam.get(question.examId) ?? []
    list.push(question)
    byExam.set(question.examId, list)
  }

  const groups = [...byExam.entries()].map(([examId, rows]) => {
    let solved = 0
    let correct = 0
    for (const row of rows) {
      const state = states.get(row.id)
      if (state && state.attempts > 0) {
        solved += 1
        if (state.isCorrect) correct += 1
      }
    }
    return {
      examId,
      label: labelOf(examId),
      progress: { total: rows.length, solved, correct },
    }
  })

  // 최신 학번(연도)이 위로 오도록 정렬한다. label 이 "2026 학년말고사"처럼 연도로 시작한다.
  return groups.sort((a, b) => {
    const yearA = Number(a.label.match(/^\d{4}/)?.[0] ?? 0)
    const yearB = Number(b.label.match(/^\d{4}/)?.[0] ?? 0)
    if (yearA !== yearB) return yearB - yearA
    return a.label.localeCompare(b.label)
  })
}

/** 단원에 속한 시험(연도)을 나열한다. 시험을 골라야 문제를 풀 수 있다. */
export function UnitQuestionsPage() {
  const { subjectId, unitId } = useParams()
  const { taxonomy } = useData()
  const unlabeled = unitId === UNLABELED
  // 요청 키를 결과에 함께 담아두면 로딩 상태를 파생시킬 수 있어
  // 이펙트 안에서 동기적으로 setState 하지 않아도 된다.
  const requestKey = `${subjectId ?? ''}|${unitId ?? ''}`

  const [loaded, setLoaded] = useState<{
    key: string
    questions: SolveQuestion[]
    states: Map<string, QuestionState>
  } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)

  const questions = useMemo(
    () => (loaded?.key === requestKey ? loaded.questions : []),
    [loaded, requestKey],
  )
  const states = useMemo(
    () => (loaded?.key === requestKey ? loaded.states : new Map<string, QuestionState>()),
    [loaded, requestKey],
  )
  const error = failed?.key === requestKey ? failed.message : null
  const loading = loaded?.key !== requestKey && error === null

  useEffect(() => {
    if (!unitId) return
    let active = true

    async function load() {
      try {
        const rows = await fetchQuestions(
          unlabeled ? { unlabeledOnly: true, subjectId } : { unitId },
        )
        const nextStates = await fetchQuestionStates(rows.map((row) => row.id))
        if (active) setLoaded({ key: requestKey, questions: rows, states: nextStates })
      } catch (caught) {
        if (!active) return
        setFailed({
          key: requestKey,
          message: caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.',
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [unitId, subjectId, unlabeled, requestKey])

  const examGroups = useMemo(
    () =>
      groupByExam(
        questions,
        states,
        (examId) => examYearLabel(taxonomy?.examById.get(examId)),
      ),
    [questions, states, taxonomy],
  )

  if (!subjectId || !unitId) return <Navigate to="/study" replace />

  const subject = taxonomy?.subjectById.get(subjectId)
  const unit = unlabeled ? null : taxonomy?.unitById.get(unitId)
  const title = unlabeled ? '미분류' : (unit?.name ?? '단원')

  // exam 을 빼면 단원 전체가 범위가 된다.
  const scopeHref = unlabeled ? `/solve?subject=${subjectId}&unlabeled=1` : `/solve?unit=${unitId}`
  const solveHref = (examId: string) => `${scopeHref}&exam=${examId}`

  return (
    <section>
      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/study/${subjectId}`}
            className="text-xs text-slate-500 hover:underline dark:text-slate-400"
          >
            {subject?.name ?? '과목'}
          </Link>
          <h1 className="mt-0.5 truncate text-xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            문제 {questions.length}개, 시험 {examGroups.length}개
          </p>
        </div>
        {examGroups.length > 0 && (
          <Link
            to={scopeHref}
            className="mt-4 inline-flex h-9 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            전체 풀기
          </Link>
        )}
      </header>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : examGroups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 문제가 없습니다.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {examGroups.map((group) => (
            <li key={group.examId} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{group.label}</p>
                <div className="mt-1">
                  <ProgressBadge progress={group.progress} />
                </div>
              </div>
              <Link
                to={solveHref(group.examId)}
                className="inline-flex h-9 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
              >
                풀이 시작
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
