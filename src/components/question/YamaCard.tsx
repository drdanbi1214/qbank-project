import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StemBlocks } from '@/components/question/StemBlocks'
import { QuestionLookup } from '@/components/question/QuestionLookup'
import { useCluster } from '@/components/question/useCluster'
import { SolutionList } from '@/components/solution/SolutionList'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { fetchQuestionById, type SolveQuestion } from '@/lib/queries/questions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import type { ClusterSibling, VariantType } from '@/lib/queries/clusters'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string | null
  /** 편집기에서 노드가 선택된 상태 */
  selected?: boolean
  /** 편집기에서만 넘어온다. 있으면 빼기·묶기 버튼을 보여준다. */
  onRemove?: () => void
}

const VARIANT_LABEL: Record<VariantType, string> = {
  identical: '완전히 동일한 문제',
  modified: '거의 비슷한 문제',
}

/**
 * 테마 본문 안에 그려지는 야마 카드.
 *
 * 좌(문제) · 우(해설) 로 나누고, 유사 문제는 아래에 전체 폭으로 깐다. 변주는
 * 문제 전체를 봐야 하는데 좁은 칼럼에 넣으면 원본과 무엇이 다른지 비교가 되지
 * 않는다. 넓은 화면에서만 2단이고 좁으면 세로로 쌓인다.
 *
 * 문제를 못 가져오면 자리표시자를 그린다. 지워졌거나, 시험이 draft 거나, 보는
 * 사람에게 그 학번 열람 권한이 없는 경우다. 본문 흐름은 끊기지 않는다.
 */
export function YamaCard({ questionId, selected = false, onRemove }: Props) {
  const { taxonomy } = useData()
  const [question, setQuestion] = useState<SolveQuestion | null | 'missing'>(
    questionId ? null : 'missing',
  )

  useEffect(() => {
    if (!questionId) return
    let active = true
    void fetchQuestionById(questionId)
      .then((found) => {
        if (active) setQuestion(found ?? 'missing')
      })
      .catch(() => {
        if (active) setQuestion('missing')
      })
    return () => {
      active = false
    }
  }, [questionId])

  if (question === null) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
        <Spinner className="h-4 w-4" />
      </div>
    )
  }

  if (question === 'missing') {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400',
          selected && 'ring-2 ring-brand-500',
        )}
      >
        이 야마는 지금 볼 수 없습니다. 문제가 지워졌거나, 해당 학번 열람 권한이 없습니다.
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-2 text-xs underline hover:text-rose-600 dark:hover:text-rose-400"
          >
            본문에서 빼기
          </button>
        )}
      </div>
    )
  }

  return (
    <YamaBody
      question={question}
      selected={selected}
      subjectId={taxonomy?.examById.get(question.examId)?.subjectId ?? null}
      onRemove={onRemove}
    />
  )
}

// -----------------------------------------------------------------------------

/** 문제를 받아온 뒤의 본문. 훅 순서가 흔들리지 않도록 컴포넌트를 나눴다. */
function YamaBody({
  question,
  selected,
  subjectId,
  onRemove,
}: {
  question: SolveQuestion
  selected: boolean
  subjectId: string | null
  onRemove?: () => void
}) {
  const { taxonomy } = useData()
  const { isAdmin, hasPermission } = useAuth()
  const editing = Boolean(onRemove)
  const canCluster = editing && (isAdmin || hasPermission('study_legendob'))

  const { groupId, identical, modified, attach, detach, ensureGroup } = useCluster(
    question.id,
    question.groupId,
  )

  const [adding, setAdding] = useState<VariantType | null>(null)
  // 변주는 펼치면 해설이 바로 나온다. 원본만 따로 눌러야 하면 앞뒤가 안 맞고,
  // 해설 자리가 아예 안 보여 어디에 쓰는지 알 수 없다. 그래서 기본으로 연다.
  const [openSolution, setOpenSolution] = useState(true)
  const [solutionGroupId, setSolutionGroupId] = useState<string | null>(groupId)
  // 편집 화면에서 그룹을 준비하는 동안에는 해설을 그리지 않는다. 준비 전에
  // 그리면 그룹 없이 문제에 붙는 풀이가 만들어질 수 있다.
  const preparing = canCluster && solutionGroupId === null

  const examLabel = useCallback(
    (examId: string) => {
      const exam = taxonomy?.examById.get(examId)
      const name = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, name)
    },
    [taxonomy],
  )

  /**
   * 해설은 항상 그룹에 붙인다. 그룹 없이 문제에 직접 붙이면 나중에 판본을 묶어도
   * 해설이 따라가지 않는다.
   *
   * 테마에 꽂힌 야마는 어차피 "비슷한 문제를 모아 하나로 설명한다" 는 대상이므로,
   * 편집 화면에서 카드를 열 때 그룹을 미리 만들어 둔다. 혼자짜리 그룹은 배너에
   * 아무것도 더하지 않아 무해하다.
   */
  useEffect(() => {
    if (!canCluster || solutionGroupId) return
    let active = true
    void ensureGroup()
      .then((id) => {
        if (active) setSolutionGroupId(id)
      })
      .catch((caught: unknown) => {
        console.error('야마 그룹을 준비하지 못했습니다.', caught)
      })
    return () => {
      active = false
    }
  }, [canCluster, solutionGroupId, ensureGroup])

  return (
    <div
      className={cn(
        'rounded-lg border-l-2 border-emerald-500 bg-emerald-50/40 px-3 py-2.5 dark:bg-emerald-950/20',
        selected && 'ring-2 ring-brand-500',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          data-drag-handle={editing ? '' : undefined}
          className={cn(
            'rounded bg-emerald-600 px-1.5 py-0.5 font-semibold text-white',
            editing && 'cursor-grab active:cursor-grabbing',
          )}
        >
          야마
        </span>
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {examLabel(question.examId)} {question.questionNumber}번
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenSolution((value) => !value)}
            className="font-medium text-emerald-700 hover:underline dark:text-emerald-300"
          >
            {openSolution ? '해설 접기' : '해설 보기'}
          </button>
          <Link
            to={`/solve?question=${question.id}`}
            className="text-brand-600 hover:underline dark:text-brand-300"
          >
            풀어보기
          </Link>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-slate-400 underline hover:text-rose-600 dark:hover:text-rose-400"
            >
              빼기
            </button>
          )}
        </span>
      </div>

      {/* 좌 문제 / 우 해설. 해설을 접으면 문제가 전체 폭을 쓴다. */}
      <div className={cn('gap-3', openSolution && 'lg:grid lg:grid-cols-2')}>
        <section className="rounded-lg border border-slate-300 bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900">
          <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            문제
          </h4>
          <div className="text-[15px] font-semibold leading-relaxed">
            <StemBlocks blocks={question.stemBlocks} />
          </div>
          <ol className="mt-1.5 space-y-0.5 text-sm">
            {question.choices.map((choice) => (
              <li key={choice.no} className="text-slate-700 dark:text-slate-300">
                {choice.text}
              </li>
            ))}
          </ol>
        </section>

        {openSolution && (
          <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 lg:mt-0">
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              해설
            </h4>
            {preparing ? (
              <div className="flex justify-center py-6">
                <Spinner className="h-4 w-4" />
              </div>
            ) : (
            <SolutionList
              questionId={question.id}
              groupId={solutionGroupId}
              choiceCount={question.choices.length}
              subjectId={subjectId}
              unitId={question.unitId}
              unitSource={question.unitSource}
            />
            )}
            {identical.length > 0 && (
              <p className="mt-2 inline-flex rounded-full border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                동일 출제&nbsp;
                <b className="font-semibold text-slate-800 dark:text-slate-100">
                  {identical
                    .map((row) => `${examLabel(row.examId)} ${row.questionNumber}번`)
                    .join(' · ')}
                </b>
              </p>
            )}
          </section>
        )}
      </div>

      {modified.length > 0 && (
        <>
          <h4 className="mb-1.5 mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
            유사 문제
            <span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {modified.length}
            </span>
          </h4>
          {modified.map((row) => (
            <VariantRow
              key={row.id}
              row={row}
              examLabel={examLabel}
              subjectId={subjectId}
              canCluster={canCluster}
              onDetach={() => detach(row.id)}
            />
          ))}
        </>
      )}

      {canCluster && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="secondary" size="sm" onClick={() => setAdding('identical')}>
            + 완전히 동일한 문제
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAdding('modified')}>
            + 거의 비슷한 문제
          </Button>
        </div>
      )}

      {adding && taxonomy && (
        <div className="mt-2 rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
          <h4 className="mb-2 text-sm font-semibold">{VARIANT_LABEL[adding]} 추가</h4>
          <QuestionLookup
            exams={taxonomy.exams}
            subjectId={subjectId}
            excludeExamId={question.examId}
            excludeQuestionId={question.id}
            rejectGrouped
            examLabelOf={examLabel}
            confirmLabel="이 문제로 확정"
            onCancel={() => setAdding(null)}
            onPick={(found) => {
              void attach(found.id, adding)
                .then(() => setAdding(null))
                .catch((caught: unknown) => {
                  window.alert(caught instanceof Error ? caught.message : '묶지 못했습니다.')
                })
            }}
          />
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------

/**
 * 유사 문제 한 줄.
 *
 * 접혀 있어도 학번·번호와 차이 설명이 보여 훑기에 충분하다. 펼치면 원본과 같은
 * 규칙으로 좌(문제)·우(그 변주의 해설)가 된다.
 */
function VariantRow({
  row,
  examLabel,
  subjectId,
  canCluster,
  onDetach,
}: {
  row: ClusterSibling
  examLabel: (examId: string) => string
  subjectId: string | null
  canCluster: boolean
  onDetach: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mb-1.5 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs"
      >
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
          변주
        </span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">
          {examLabel(row.examId)} {row.questionNumber}번
        </span>
        <span className="text-amber-700 dark:text-amber-400">지문이 조금 다릅니다</span>
      </button>

      {open && (
        <div className="gap-3 border-t border-slate-200 p-2.5 dark:border-slate-700 lg:grid lg:grid-cols-2">
          <section className="rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900">
            <h5 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              문제
            </h5>
            <div className="text-sm font-semibold leading-relaxed">
              <StemBlocks blocks={row.stemBlocks} />
            </div>
            <ol className="mt-1 space-y-0.5 text-[13px]">
              {row.choices.map((choice) => (
                <li key={choice.no} className="text-slate-700 dark:text-slate-300">
                  {choice.text}
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-2.5 rounded-md border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900 lg:mt-0">
            <h5 className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              이 변주의 해설
            </h5>
            {/* groupId 를 주지 않아 이 문제에만 붙는다. 원본을 풀 때는 안 보이고
                이 판본을 풀 때 공유 해설과 함께 나온다. */}
            <SolutionList
              questionId={row.id}
              groupId={null}
              choiceCount={row.choices.length}
              subjectId={subjectId}
              unitId={row.unitId}
              unitSource={row.unitSource}
            />
            {canCluster && (
              <button
                type="button"
                onClick={onDetach}
                className="mt-2 text-[11px] text-slate-400 underline hover:text-rose-600 dark:hover:text-rose-400"
              >
                이 문제 묶기 풀기
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
