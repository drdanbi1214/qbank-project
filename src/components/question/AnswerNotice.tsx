import { formatAnswer, sameAnswer, type AnswerPayload } from '@/types/question'
import { cn } from '@/utils/cn'

type Props = {
  answer: AnswerPayload
}

/**
 * 정답 메모(answerNote)는 있으면 항상 보여준다. 야마답과 편집자 판단이
 * 갈릴 때는 그 사실도 함께 경고 박스로 안내한다.
 *
 * 편집자답이 아직 없으면 야마답이 곧 채점 기준이므로 충돌 경고는 띄우지
 * 않는다. 복기 자료를 막 넣은 시점에는 대부분이 그 상태라, 미확정 안내를
 * 띄우면 거의 모든 문제에 경고가 붙어 정작 봐야 할 문항이 묻힌다.
 */
export function AnswerNotice({ answer }: Props) {
  const yama = answer.yamaAnswer ?? []
  const hasYama = yama.length > 0
  const hasEditor = answer.editorAnswer.length > 0

  const conflicts = hasYama && hasEditor && !sameAnswer(yama, answer.editorAnswer)
  if (!conflicts && !answer.answerNote) return null

  return (
    <div
      className={cn(
        'rounded-xl border p-3 text-sm',
        conflicts
          ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'
          : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40',
      )}
    >
      {conflicts && (
        <>
          <p className="font-semibold text-rose-900 dark:text-rose-200">
            야마답과 편집자 판단이 다릅니다
          </p>
          <p className="mt-1 text-rose-800 dark:text-rose-300">
            야마답 {formatAnswer(yama)}, 편집자답 {formatAnswer(answer.editorAnswer)}. 채점은
            편집자답 기준입니다.
          </p>
        </>
      )}
      {answer.answerNote && (
        <p
          className={cn(
            'whitespace-pre-wrap',
            conflicts
              ? 'mt-2 rounded-lg bg-white/70 p-2 text-rose-900 dark:bg-slate-900/50 dark:text-rose-200'
              : 'text-slate-700 dark:text-slate-300',
          )}
        >
          {answer.answerNote}
        </p>
      )}
    </div>
  )
}
