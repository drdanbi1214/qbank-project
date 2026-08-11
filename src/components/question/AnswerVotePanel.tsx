import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { castAnswerVote, fetchAnswerVotes, type AnswerVoteSummary } from '@/lib/queries/questions'
import { circled, type Choice } from '@/types/question'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string
  userId: string
  choices: Choice[]
  answerCount: number
}

/**
 * answer_status = 'unconfirmed' 인 문제에서 "다른 사람들은 뭘 골랐나" 를 집계한다.
 */
export function AnswerVotePanel({ questionId, userId, choices, answerCount }: Props) {
  const [summary, setSummary] = useState<AnswerVoteSummary | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void fetchAnswerVotes(questionId, userId)
      .then((next) => {
        if (!active) return
        setSummary(next)
        setPicked(next.myVote ?? [])
      })
      .catch((error: unknown) => console.error('정답 투표를 불러오지 못했습니다.', error))
    return () => {
      active = false
    }
  }, [questionId, userId])

  function toggle(no: number) {
    if (answerCount < 2) {
      setPicked([no])
      return
    }
    setPicked((prev) =>
      prev.includes(no) ? prev.filter((v) => v !== no) : [...prev, no].sort((a, b) => a - b),
    )
  }

  async function save() {
    if (picked.length === 0) return
    setSaving(true)
    try {
      await castAnswerVote({ questionId, userId, votedAnswer: picked })
      setSummary(await fetchAnswerVotes(questionId, userId))
    } catch (error) {
      console.error('투표를 저장하지 못했습니다.', error)
    } finally {
      setSaving(false)
    }
  }

  const total = summary?.totalVotes ?? 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-sm font-semibold">정답 투표</h3>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        아직 확정되지 않은 문제입니다. 어떤 답이 맞다고 보시나요?
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {choices.map((choice) => {
          const votes = summary?.distribution[choice.no] ?? 0
          const share = total > 0 ? Math.round((votes / total) * 100) : 0
          const isPicked = picked.includes(choice.no)

          return (
            <button
              key={choice.no}
              type="button"
              onClick={() => toggle(choice.no)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-sm transition-colors',
                isPicked
                  ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
                  : 'border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800',
              )}
            >
              {circled(choice.no)}
              {total > 0 && (
                <span className="ml-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {share}%
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={() => void save()} disabled={picked.length === 0 || saving}>
          {summary?.myVote ? '투표 변경' : '투표하기'}
        </Button>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {total > 0 ? `${total}명 참여` : '아직 투표가 없습니다'}
        </span>
      </div>
    </section>
  )
}
