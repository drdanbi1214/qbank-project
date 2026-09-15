import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  fetchAnswerOpinions,
  saveMyAnswerOpinion,
  type AnswerOpinion,
} from '@/lib/queries/answerOpinions'
import { circled, formatAnswer, type Choice } from '@/types/question'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string
  choices?: Choice[]
  /** 레옵스에서는 이 글을 쓴 사람의 의견을 항상 맨 앞에 둔다. */
  preferredAuthorId?: string | null
  baselineAnswer?: number[] | null
  baselineLabel?: string
  allowEdit?: boolean
  compact?: boolean
}

const AUDIENCE_LABEL: Record<string, string> = {
  study_hapbon3: '합본3',
  study_legendob: '레옵스',
  study_clover: '네잎클로버',
}

function sameAnswer(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function AnswerOpinions({
  questionId,
  choices = [],
  preferredAuthorId = null,
  baselineAnswer = null,
  baselineLabel = '기준 답',
  allowEdit = true,
  compact = false,
}: Props) {
  const { session, isPending } = useAuth()
  const userId = session?.user.id ?? ''
  const [opinions, setOpinions] = useState<AnswerOpinion[] | null>(null)
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetchAnswerOpinions(questionId)
      .then((rows) => {
        setOpinions(rows)
        setSelection(rows.find((row) => row.authorId === userId)?.answer ?? [])
        setError(null)
      })
      .catch((caught: unknown) => {
        setOpinions([])
        setError(caught instanceof Error ? caught.message : '풀이자 답을 불러오지 못했습니다.')
      })
  }, [questionId, userId])

  useEffect(() => {
    load()
  }, [load])

  const ordered = useMemo(() => {
    if (!opinions) return []
    return [...opinions].sort((left, right) => {
      const leftPreferred = left.authorId === preferredAuthorId ? 1 : 0
      const rightPreferred = right.authorId === preferredAuthorId ? 1 : 0
      if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred
      return right.updatedAt.localeCompare(left.updatedAt)
    })
  }, [opinions, preferredAuthorId])

  const canEdit = allowEdit && Boolean(userId) && !isPending && choices.length > 0

  const toggle = (no: number) => {
    setSelection((current) => current.includes(no)
      ? current.filter((value) => value !== no)
      : [...current, no].sort((a, b) => a - b))
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await saveMyAnswerOpinion(questionId, selection)
      setOpen(false)
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '풀이자 답을 저장하지 못했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (opinions === null) {
    return <div className="mt-2 flex justify-center py-1"><Spinner className="h-3.5 w-3.5" /></div>
  }

  if (opinions.length === 0 && !canEdit) return null

  return (
    <section className={cn(
      'mt-2 rounded-lg border border-violet-200 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/25',
      compact ? 'px-2.5 py-2 text-xs' : 'p-3 text-sm',
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-violet-900 dark:text-violet-200">풀이자 답</strong>
        {canEdit && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto rounded border border-violet-300 bg-white px-2 py-1 text-xs font-semibold text-violet-700 hover:border-violet-500 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-300"
          >
            {selection.length ? `내 답 ${formatAnswer(selection)} 수정` : '내 답 등록'}
          </button>
        )}
      </div>

      {ordered.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {ordered.map((opinion) => {
            const differs = baselineAnswer?.length
              ? !sameAnswer(opinion.answer, baselineAnswer)
              : null
            const audiences = opinion.permissionKeys
              .map((key) => AUDIENCE_LABEL[key] ?? key)
            return (
              <li key={opinion.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {opinion.authorId === preferredAuthorId && (
                  <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    게시물 작성자
                  </span>
                )}
                <span className="font-medium text-slate-800 dark:text-slate-200">{opinion.authorName}</span>
                <strong className="text-violet-700 dark:text-violet-300">{formatAnswer(opinion.answer)}</strong>
                {differs !== null && (
                  <span className={differs ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'}>
                    · {baselineLabel}과 {differs ? '다름' : '같음'}
                  </span>
                )}
                <span className="text-[10px] text-slate-400">
                  · {audiences.length ? audiences.join('·') : '전체'}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {open && (
        <div className="mt-2 border-t border-violet-200 pt-2 dark:border-violet-900">
          <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
            내가 정답이라고 생각하는 선지를 모두 선택하세요.
          </p>
          <ul className="space-y-0.5">
            {choices.map((choice) => {
              const selected = selection.includes(choice.no)
              return (
                <li key={choice.no}>
                  <button
                    type="button"
                    onClick={() => toggle(choice.no)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded px-2 py-1 text-left',
                      selected ? 'bg-violet-100 dark:bg-violet-900/40' : 'hover:bg-white/80 dark:hover:bg-slate-900/50',
                    )}
                  >
                    <span className="font-bold text-violet-700 dark:text-violet-300">{circled(choice.no)}</span>
                    <span>{choice.text ?? '(이미지 보기)'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>취소</Button>
            {selection.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => setSelection([])}>의견 삭제</Button>
            )}
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? '저장 중…' : selection.length ? '저장' : '삭제'}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-300">{error}</p>}
    </section>
  )
}
