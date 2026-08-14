import { useSignedUrl } from '@/lib/storage'
import { circled, effectiveAnswer, type AnswerPayload, type Choice } from '@/types/question'
import { cn } from '@/utils/cn'

type Props = {
  choices: Choice[]
  selected: number[]
  onChange: (next: number[]) => void
  /** 정답 확인 전에는 null. 이 값이 없으면 정답 힌트가 화면에 존재하지 않는다. */
  revealed: AnswerPayload | null
  disabled?: boolean
}

/**
 * 선지 선택은 항상 다중 선택이다.
 *
 * 원래는 문항의 answer_count 를 보고 1개면 라디오, 2개 이상이면 체크박스로
 * 갈랐다. 복기 데이터의 answer_count 를 전적으로 믿을 수 없어(라벨링과
 * 무관하게 실제로는 정답이 여러 개일 수도 있다), 학생이 몇 개든 원하는
 * 만큼 고를 수 있게 하고 채점은 언제나 정답 집합과 정확히 일치하는지로
 * 가린다. 편집자가 답을 정할 때도 같은 규칙을 쓴다.
 */
export function ChoiceList({ choices, selected, onChange, revealed, disabled = false }: Props) {
  const locked = disabled || revealed !== null
  // 편집자답이 없으면 야마답이 곧 정답이다.
  const answer = revealed ? effectiveAnswer(revealed) : []

  function toggle(no: number) {
    if (locked) return
    onChange(
      selected.includes(no)
        ? selected.filter((value) => value !== no)
        : [...selected, no].sort((a, b) => a - b),
    )
  }

  return (
    <ul role="group">
      {choices.map((choice) => {
        const isSelected = selected.includes(choice.no)
        const isAnswer = answer.includes(choice.no)
        const inEditor = revealed?.editorAnswer.includes(choice.no) ?? false
        const inYama = revealed?.yamaAnswer?.includes(choice.no) ?? false
        // 내가 고른 오답만 X 로 표시한다. 고르지 않은 오답은 건드리지 않는다.
        const isMyWrong = revealed !== null && isSelected && !isAnswer

        return (
          <li key={choice.no}>
            <button
              type="button"
              onClick={() => toggle(choice.no)}
              disabled={locked}
              aria-pressed={isSelected}
              className={cn(
                'flex w-full items-start gap-3 rounded-lg px-1 py-2 text-left transition-colors',
                locked ? 'cursor-default' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
              )}
            >
              <Indicator
                state={
                  revealed === null
                    ? isSelected
                      ? 'selected'
                      : 'idle'
                    : isAnswer
                      ? 'correct'
                      : isMyWrong
                        ? 'wrong'
                        : 'idle'
                }
              />

              <span
                className={cn(
                  'shrink-0 text-base font-semibold leading-6',
                  isAnswer || (isSelected && revealed === null)
                    ? 'text-brand-600 dark:text-brand-300'
                    : 'text-slate-400',
                )}
              >
                {circled(choice.no)}
              </span>

              <span className="min-w-0 flex-1">
                {choice.text && (
                  <span
                    className={cn(
                      'block whitespace-pre-wrap text-[15px] leading-6',
                      isAnswer && 'font-medium text-brand-600 dark:text-brand-300',
                    )}
                  >
                    {choice.text}
                  </span>
                )}
                {choice.imageUrl && choice.imageUrl !== 'PLACEHOLDER' && (
                  <ChoiceImage url={choice.imageUrl} no={choice.no} />
                )}
              </span>

              {/* 정답 표시는 오른쪽 끝에 세운다. */}
              {revealed && (inEditor || inYama) && (
                <span
                  className={cn(
                    'shrink-0 self-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold',
                    isAnswer ? 'bg-brand-600 text-white' : 'bg-amber-500 text-white',
                  )}
                >
                  {inYama && inEditor ? 'Y답/편집자답' : inEditor ? '편집자답' : 'Y답'}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 선지 앞의 네모.
 * 확인 전에는 체크박스, 확인 후에는 정답에 체크 표시와 내가 고른 오답에
 * X 표시가 들어간다.
 */
function Indicator({ state }: { state: 'idle' | 'selected' | 'correct' | 'wrong' }) {
  if (state === 'correct' || state === 'wrong') {
    return (
      <span
        className={cn(
          'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full',
          state === 'correct' ? 'bg-brand-600' : 'bg-marker-red',
        )}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3 text-white">
          <path
            d={state === 'correct' ? 'M5 13l4 4L19 7' : 'M7 7l10 10M17 7L7 17'}
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }

  return (
    <span
      className={cn(
        'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border-2 transition-colors',
        state === 'selected'
          ? 'border-brand-600 bg-brand-600'
          : 'border-slate-300 dark:border-slate-600',
      )}
    >
      {state === 'selected' && <span className="block h-1.5 w-2.5 rounded-[1px] bg-white" />}
    </span>
  )
}

function ChoiceImage({ url, no }: { url: string; no: number }) {
  const src = useSignedUrl(url)
  if (!src) {
    return (
      <span className="mt-1 block h-24 rounded-lg border border-dashed border-slate-300 dark:border-slate-700" />
    )
  }
  return (
    <img
      src={src}
      alt={`보기 ${no}`}
      loading="lazy"
      className="mt-1 max-h-48 rounded-lg border border-slate-200 object-contain dark:border-slate-700"
    />
  )
}
