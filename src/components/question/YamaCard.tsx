import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StemBlocks } from '@/components/question/StemBlocks'
import { ClusterPanel } from '@/components/question/ClusterPanel'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { fetchQuestionById } from '@/lib/queries/questions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import type { SolveQuestion } from '@/lib/queries/questions'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string | null
  /** 편집기에서 노드가 선택된 상태 */
  selected?: boolean
  /** 편집기에서만 넘어온다. 있으면 빼기 버튼과 묶기 버튼을 보여준다. */
  onRemove?: () => void
}

/**
 * 테마 본문 안에 그려지는 야마 카드. 편집기와 뷰어가 같은 것을 쓴다.
 *
 * 문제를 못 가져오면 자리표시자를 그린다. 지워졌거나, 시험이 아직 draft 거나,
 * 보는 사람에게 그 학번 열람 권한이 없는 경우다(questions_solve 뷰가 걸러낸다).
 * 본문 흐름이 끊기지 않게 자리는 남긴다.
 */
export function YamaCard({ questionId, selected = false, onRemove }: Props) {
  const { taxonomy } = useData()
  const { isAdmin, hasPermission } = useAuth()
  // 묶기는 이론을 쓰는 자리에서만 한다. 읽기만 할 때는 배너와 변주만 보인다.
  const canCluster = Boolean(onRemove) && (isAdmin || hasPermission('study_legendob'))
  // id 가 없으면 조회할 것도 없으므로 처음부터 자리표시자 상태로 둔다.
  // 이펙트 안에서 동기적으로 setState 하지 않기 위한 초기값 분기다.
  const [question, setQuestion] = useState<SolveQuestion | null | 'missing'>(
    questionId ? null : 'missing',
  )

  useEffect(() => {
    if (!questionId) return
    let active = true
    void fetchQuestionById(questionId)
      .then((found) => {
        if (!active) return
        setQuestion(found ?? 'missing')
      })
      .catch(() => {
        if (active) setQuestion('missing')
      })
    return () => {
      active = false
    }
  }, [questionId])

  const subjectIdOf = (examId: string) =>
    taxonomy?.examById.get(examId)?.subjectId ?? null

  const examLabel = (examId: string) => {
    const exam = taxonomy?.examById.get(examId)
    const subjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
    return examShortLabel(exam, subjectName)
  }

  if (question === null) {
    return (
      <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
        <Spinner className="h-4 w-4" />
      </div>
    )
  }

  if (question === 'missing') {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400',
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
    <div
      className={cn(
        'rounded-lg border-l-2 border-emerald-500 bg-emerald-50/40 px-3 py-3 dark:bg-emerald-950/20',
        selected && 'ring-2 ring-brand-500',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {/* 드래그 핸들은 이 배지에만 둔다. 카드 전체가 핸들이면 안쪽 입력창에서
            글자를 고를 때 카드가 끌려간다. */}
        <span
          data-drag-handle={onRemove ? '' : undefined}
          className={cn(
            'rounded bg-emerald-600 px-1.5 py-0.5 font-semibold text-white',
            onRemove && 'cursor-grab active:cursor-grabbing',
          )}
        >
          야마
        </span>
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {examLabel(question.examId)} {question.questionNumber}번
        </span>
        <span className="ml-auto flex items-center gap-2">
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

      <StemBlocks blocks={question.stemBlocks} />

      <ol className="mt-2 space-y-1 text-sm">
        {question.choices.map((choice) => (
          <li key={choice.no} className="text-slate-700 dark:text-slate-300">
            {choice.no}. {choice.text}
          </li>
        ))}
      </ol>

      {/* 같은 논점을 묻는 다른 학번 판본을 여기서 모은다. 이론을 쓰면서 비슷한
          문제를 묶어 함께 설명하는 것이 이 기능의 주된 쓰임이다. */}
      <div className="mt-3">
        <ClusterPanel
          questionId={question.id}
          examId={question.examId}
          initialGroupId={question.groupId}
          subjectId={subjectIdOf(question.examId)}
          examLabelOf={examLabel}
          canCluster={canCluster}
        />
      </div>
    </div>
  )
}
