import { Link } from 'react-router-dom'
import { formatAnswer, sameAnswer, type AnswerPayload } from '@/types/question'

type Props = {
  answer: AnswerPayload
  questionId: string
  /** 이 문제에 연결된 게시판 스레드 수 */
  threadCount: number
}

/**
 * 야마답과 편집자답이 다르면 해설 상단에 경고 배너를 띄운다.
 * 채점은 언제나 편집자답 기준이라는 점을 분명히 안내한다.
 */
export function AnswerNotice({ answer, questionId, threadCount }: Props) {
  const hasYama = answer.yamaAnswer !== null && answer.yamaAnswer.length > 0
  const hasEditor = answer.editorAnswer.length > 0
  // 편집자답이 아직 없으면 비교할 대상이 없으므로 미확정 안내만 띄운다.
  const conflicts = hasYama && hasEditor && !sameAnswer(answer.yamaAnswer ?? [], answer.editorAnswer)

  if (!conflicts && answer.answerStatus !== 'unconfirmed' && hasEditor) return null

  if (!conflicts) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
        <p className="font-semibold text-amber-900 dark:text-amber-200">정답 미확정</p>
        <p className="mt-1 text-amber-800 dark:text-amber-300">
          아직 편집자 검토가 끝나지 않아 채점 기준이 정해지지 않은 문제입니다.
          {hasYama && ` 복기 당시 통용된 답은 ${formatAnswer(answer.yamaAnswer ?? [])} 입니다.`}
        </p>
        <Link
          to={`/discussions?question=${questionId}`}
          className="mt-2 inline-block font-medium text-amber-800 underline dark:text-amber-300"
        >
          관련 게시판 스레드 보기{threadCount > 0 ? ` (${threadCount})` : ''}
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950/40">
      <p className="font-semibold text-rose-900 dark:text-rose-200">
        야마답과 편집자 판단이 다릅니다
      </p>
      <p className="mt-1 text-rose-800 dark:text-rose-300">
        야마답 {formatAnswer(answer.yamaAnswer ?? [])}, 편집자답{' '}
        {formatAnswer(answer.editorAnswer)}. 채점은 편집자답 기준입니다.
      </p>
      {answer.answerNote && (
        <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/70 p-2 text-rose-900 dark:bg-slate-900/50 dark:text-rose-200">
          {answer.answerNote}
        </p>
      )}
      <Link
        to={`/discussions?question=${questionId}`}
        className="mt-2 inline-block font-medium text-rose-700 underline dark:text-rose-300"
      >
        관련 게시판 스레드 보기{threadCount > 0 ? ` (${threadCount})` : ''}
      </Link>
    </div>
  )
}
