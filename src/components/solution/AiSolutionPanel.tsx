import { useEffect, useState } from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Spinner } from '@/components/ui/Spinner'
import { fetchAiSolution, type AiSolution } from '@/lib/queries/aiSolutions'

type Props = { questionId: string }

/**
 * AI 풀이 권한 전용 탭 내용. 호출부(QuestionView)에서 권한이 있을 때만
 * 탭 버튼과 함께 렌더한다. 데이터 원본도 같은 권한의 RLS로 막혀 있다.
 */
export function AiSolutionPanel({ questionId }: Props) {
  const [loaded, setLoaded] = useState<{
    key: string
    solution: AiSolution | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let active = true
    fetchAiSolution(questionId)
      .then((next) => {
        if (active) setLoaded({ key: questionId, solution: next, error: null })
      })
      .catch((caught) => {
        if (active) {
          setLoaded({
            key: questionId,
            solution: null,
            error: caught instanceof Error ? caught.message : 'AI 풀이를 불러오지 못했습니다.',
          })
        }
      })
    return () => {
      active = false
    }
  }, [questionId])

  const loading = loaded?.key !== questionId
  const solution = loading ? null : loaded.solution
  const error = loading ? null : loaded.error

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (error) {
    return <p className="py-4 text-sm text-marker-red">{error}</p>
  }

  if (!solution) {
    return (
      <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
        아직 이 문제에 등록된 AI 풀이가 없습니다.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
      <p className="mb-2 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
        AI 풀이
      </p>
      <RichTextViewer doc={solution.content} />
    </div>
  )
}
