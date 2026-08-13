import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useData } from '@/lib/data'

/**
 * 게시글에 연결된 문제 카드.
 * question_id 가 없는 일반글에서는 아예 렌더링하지 않는다.
 */
export function LinkedQuestionCard({
  questionId,
  unitId,
  stem,
}: {
  questionId: string
  unitId: string | null
  stem: string | null
}) {
  const navigate = useNavigate()
  const { taxonomy } = useData()
  const unitName = unitId ? (taxonomy?.unitById.get(unitId)?.name ?? null) : null

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-lg border border-brand-200 bg-brand-50/60 p-2 dark:border-brand-800 dark:bg-brand-900/20">
      <span className="shrink-0 rounded border border-brand-500 px-1.5 py-0.5 text-xs font-semibold text-brand-700 dark:text-brand-300">
        문제
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
        {unitName ? `${unitName} / ` : ''}
        {stem ?? '본문 없음'}
      </p>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        onClick={() => navigate(`/solve?question=${questionId}`)}
      >
        문제보기
      </Button>
    </div>
  )
}
