import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useDraft } from '@/components/editor/useDraft'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { createSolution } from '@/lib/queries/solutions'
import { setEditorAnswer } from '@/lib/queries/questions'
import { circled, type Choice } from '@/types/question'
import { emptyDoc, isEmptyDoc, type RichDoc } from '@/types/richtext'
import { formatDateTime } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string
  groupId: string | null
  choices: Choice[]
  answerCount: number
  /** 이미 편집자답이 있으면 그 값으로 시작한다 (재검토하는 경우) */
  currentEditorAnswer: number[]
  userId: string
}

/**
 * 배정 화면에서 문항을 검토할 때 쓰는 결합 폼.
 *
 * 일반 풀이 작성(SolutionEditor)과 다른 점은, 풀이 본문만 쓰는 게 아니라
 * 이 자리에서 편집자답도 함께 확정한다는 것이다. 등록을 누르면 두 가지를
 * 한 번에 저장한다: questions.editor_answer 갱신 + 풀이 등록.
 *
 * 이 화면에서의 조회/열람은 attempts 를 남기지 않는다. 누적 풀이 횟수에도
 * 잡히지 않는다 (QuestionView 가 자동 공개를 submit_attempt 가 아니라
 * reveal_answer 로 처리하기 때문에 별도 처리가 필요 없다).
 */
export function AssignmentEditor({
  questionId,
  groupId,
  choices,
  answerCount,
  currentEditorAnswer,
  userId,
}: Props) {
  const navigate = useNavigate()
  const multiple = answerCount >= 2

  const [pickerOpen, setPickerOpen] = useState(currentEditorAnswer.length > 0)
  const [selection, setSelection] = useState<number[]>(currentEditorAnswer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draftKey = groupId ?? questionId
  const { savedDraft, schedule, discard } = useDraft({
    userId,
    targetType: 'solution',
    targetKey: draftKey,
    enabled: true,
  })

  const [seed, setSeed] = useState(() => ({ doc: emptyDoc(), version: 0 }))
  const [draftDismissed, setDraftDismissed] = useState(false)
  const doc = useRef<RichDoc>(seed.doc)

  function handleChange(next: RichDoc) {
    doc.current = next
    schedule(next)
  }

  function toggleChoice(no: number) {
    if (!multiple) {
      setSelection([no])
      return
    }
    setSelection((prev) =>
      prev.includes(no) ? prev.filter((value) => value !== no) : [...prev, no].sort((a, b) => a - b),
    )
  }

  async function register() {
    const missing: string[] = []
    if (selection.length === 0) missing.push('답을 체크해주세요')
    if (isEmptyDoc(doc.current)) missing.push('풀이를 입력해주세요')
    if (missing.length > 0) {
      setError(missing.join(' / '))
      return
    }

    setBusy(true)
    setError(null)
    try {
      await setEditorAnswer(questionId, selection)
      await createSolution({
        target: { questionId, groupId },
        authorId: userId,
        content: doc.current,
        references: [],
      })
      await discard()
      navigate('/assignments')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const showDraftNotice = savedDraft !== null && !draftDismissed

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-bold">풀이 작성</h3>

      {choices.length > 0 && (
        <div className="mb-4">
          {!pickerOpen ? (
            <Button size="sm" variant="secondary" onClick={() => setPickerOpen(true)}>
              편집자 답을 체크해주세요
            </Button>
          ) : (
            <div>
              <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                정답으로 인정할 보기를 선택하세요
              </p>
              <ul className="space-y-0.5">
                {choices.map((choice) => {
                  const isSelected = selection.includes(choice.no)
                  return (
                    <li key={choice.no}>
                      <button
                        type="button"
                        onClick={() => toggleChoice(choice.no)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                          isSelected
                            ? 'bg-brand-50 dark:bg-brand-900/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        )}
                      >
                        <span
                          className={cn(
                            'grid h-4 w-4 shrink-0 place-items-center border-2 transition-colors',
                            multiple ? 'rounded' : 'rounded-full',
                            isSelected
                              ? 'border-brand-600 bg-brand-600'
                              : 'border-slate-300 dark:border-slate-600',
                          )}
                        >
                          {isSelected && (
                            <span
                              className={cn(
                                'block bg-white',
                                multiple ? 'h-1.5 w-2.5 rounded-[1px]' : 'h-1.5 w-1.5 rounded-full',
                              )}
                            />
                          )}
                        </span>
                        <span className="font-semibold text-slate-500 dark:text-slate-400">
                          {circled(choice.no)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {choice.text ?? '(이미지 보기)'}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {showDraftNotice && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          <span>{formatDateTime(savedDraft.updatedAt)}에 저장된 작성 중인 내용이 있습니다.</span>
          <div className="ml-auto flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setSeed((prev) => ({ doc: savedDraft.content, version: prev.version + 1 }))
                doc.current = savedDraft.content
                setDraftDismissed(true)
              }}
            >
              불러오기
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraftDismissed(true)
                void discard()
              }}
            >
              버리기
            </Button>
          </div>
        </div>
      )}

      <LazyRichTextEditor
        key={seed.version}
        initialValue={seed.doc}
        onChange={handleChange}
        userId={userId}
        placeholder="풀이를 작성해주세요."
        minHeight="14rem"
        onUploadError={setError}
      />

      {error && (
        <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-marker-red dark:bg-rose-950/50">
          {error}
        </p>
      )}

      <div className="mt-3">
        <Button onClick={() => void register()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          등록
        </Button>
      </div>
    </section>
  )
}
