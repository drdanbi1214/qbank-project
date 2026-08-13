import { useEffect, useState } from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchSeniorSolution,
  type SeniorSolution,
} from '@/lib/queries/seniorSolutions'

type Props = { questionId: string }

/** 탭 호출부와 DB RLS 양쪽에서 선배해설 권한을 확인한다. */
export function SeniorSolutionPanel({ questionId }: Props) {
  const [loaded, setLoaded] = useState<{
    key: string
    solution: SeniorSolution | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    let active = true
    fetchSeniorSolution(questionId)
      .then((solution) => {
        if (active) setLoaded({ key: questionId, solution, error: null })
      })
      .catch((caught) => {
        if (active) {
          setLoaded({
            key: questionId,
            solution: null,
            error: caught instanceof Error ? caught.message : '선배해설을 불러오지 못했습니다.',
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
    return <div className="flex justify-center py-8"><Spinner className="h-5 w-5" /></div>
  }
  if (error) return <p className="py-4 text-sm text-marker-red">{error}</p>
  if (!solution) {
    return (
      <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
        아직 이 문제에 등록된 선배해설이 없습니다.
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 dark:border-sky-900/60 dark:bg-sky-950/20">
      <p className="mb-2 inline-flex items-center rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
        선배해설
      </p>
      <RichTextViewer doc={solution.content} className="solution-rich-text" />
    </div>
  )
}
