import { useSignedUrl } from '@/lib/storage'
import { circled, type AnswerPayload, type Choice } from '@/types/question'
import { cn } from '@/utils/cn'

type Props = {
  choices: Choice[]
  /** 정답 개수. 2 이상이면 체크박스 UI */
  answerCount: number
  selected: number[]
  onChange: (next: number[]) => void
  /** 정답 확인 전에는 null. 이 값이 없으면 정답 힌트가 화면에 존재하지 않는다. */
  revealed: AnswerPayload | null
  disabled?: boolean
}

export function ChoiceList({
  choices,
  answerCount,
  selected,
  onChange,
  revealed,
  disabled = false,
}: Props) {
  const multiple = answerCount >= 2
  const locked = disabled || revealed !== null

  function toggle(no: number) {
    if (locked) return
    if (!multiple) {
      onChange([no])
      return
    }
    onChange(
      selected.includes(no)
        ? selected.filter((value) => value !== no)
        : [...selected, no].sort((a, b) => a - b),
    )
  }

  return (
    <div>
      {multiple && (
        <p className="mb-2 text-sm font-medium text-brand-700 dark:text-brand-300">
          정답 {answerCount}개를 고르세요.
        </p>
      )}

      <ul role={multiple ? 'group' : 'radiogroup'}>
        {choices.map((choice) => {
          const isSelected = selected.includes(choice.no)
          const inEditor = revealed?.editorAnswer.includes(choice.no) ?? false
          const inYama = revealed?.yamaAnswer?.includes(choice.no) ?? false
          // 내가 고른 오답만 X 로 표시한다. 고르지 않은 오답은 건드리지 않는다.
          const isMyWrong = revealed !== null && isSelected && !inEditor

          return (
            <li
              key={choice.no}
              className="border-b border-slate-100 last:border-b-0 dark:border-slate-800"
            >
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
                      : inEditor
                        ? 'correct'
                        : isMyWrong
                          ? 'wrong'
                          : 'idle'
                  }
                  multiple={multiple}
                />

                <span
                  className={cn(
                    'shrink-0 text-base font-semibold leading-6',
                    inEditor || (isSelected && revealed === null)
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
                        inEditor && 'font-medium text-brand-600 dark:text-brand-300',
                      )}
                    >
                      {choice.text}
                    </span>
                  )}
                  {choice.imageUrl && <ChoiceImage url={choice.imageUrl} no={choice.no} />}
                </span>

                {/* 정답 표시는 오른쪽 끝에 세운다. */}
                {revealed && (inEditor || inYama) && (
                  <span
                    className={cn(
                      'shrink-0 self-center whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-semibold',
                      inEditor ? 'bg-brand-600 text-white' : 'bg-amber-500 text-white',
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
    </div>
  )
}

/**
 * 선지 앞의 동그라미.
 * 확인 전에는 라디오나 체크박스, 확인 후에는 정답에 체크 표시와
 * 내가 고른 오답에 X 표시가 들어간다.
 */
function Indicator({
  state,
  multiple,
}: {
  state: 'idle' | 'selected' | 'correct' | 'wrong'
  multiple: boolean
}) {
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
        'mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center border-2 transition-colors',
        multiple ? 'rounded' : 'rounded-full',
        state === 'selected'
          ? 'border-brand-600 bg-brand-600'
          : 'border-slate-300 dark:border-slate-600',
      )}
    >
      {state === 'selected' && (
        <span
          className={cn(
            'block bg-white',
            multiple ? 'h-1.5 w-2.5 rounded-[1px]' : 'h-1.5 w-1.5 rounded-full',
          )}
        />
      )}
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
