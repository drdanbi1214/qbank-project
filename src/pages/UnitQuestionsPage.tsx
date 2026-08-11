import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchQuestionStates,
  fetchQuestions,
  type QuestionState,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { useData } from '@/lib/data'
import { cn } from '@/utils/cn'

const UNLABELED = 'unlabeled'

/** 단원에 속한 문제 목록. 각 문제의 내 풀이 상태를 함께 보여준다. */
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

  const questions = loaded?.key === requestKey ? loaded.questions : []
  const states = loaded?.key === requestKey ? loaded.states : new Map<string, QuestionState>()
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

  if (!subjectId || !unitId) return <Navigate to="/study" replace />

  const subject = taxonomy?.subjectById.get(subjectId)
  const unit = unlabeled ? null : taxonomy?.unitById.get(unitId)
  const title = unlabeled ? '미분류' : (unit?.name ?? '단원')

  const solveHref = unlabeled
    ? `/solve?subject=${subjectId}&unlabeled=1`
    : `/solve?unit=${unitId}`

  return (
    <section>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/study/${subjectId}`}
            className="text-xs text-slate-500 hover:underline dark:text-slate-400"
          >
            {subject?.name ?? '과목'}
          </Link>
          <h1 className="mt-0.5 truncate text-xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            문제 {questions.length}개
          </p>
        </div>

        {questions.length > 0 && (
          <Link
            to={solveHref}
            className="inline-flex h-9 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
          >
            풀이 시작
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
      ) : questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 문제가 없습니다.</p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {questions.map((question, index) => {
            const state = states.get(question.id)
            const exam = taxonomy?.examById.get(question.examId)
            const subjectName = exam
              ? taxonomy?.subjectById.get(exam.subjectId)?.name
              : undefined

            return (
              <li key={question.id}>
                <Link
                  to={`${solveHref}&i=${index}`}
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <StateMark state={state} />

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {question.stemBlocks.find((b) => b.type === 'text')?.content ??
                        '본문 없음'}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      {question.questionNumber}번 [{examShortLabel(exam, subjectName)}]
                      {question.questionType === 'essay' && ' 서술형'}
                      {question.questionType === 'R' && ' R형'}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function StateMark({ state }: { state: QuestionState | undefined }) {
  const solved = state && state.attempts > 0
  const label = !solved ? '안 푼 문제' : state.isCorrect ? '정답' : '오답'

  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
        !solved
          ? 'bg-slate-100 text-slate-400 dark:bg-slate-800'
          : state.isCorrect
            ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300'
            : 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300',
      )}
    >
      {!solved ? '-' : state.isCorrect ? 'O' : 'X'}
    </span>
  )
}
