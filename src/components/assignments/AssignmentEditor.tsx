import { useNavigate } from 'react-router-dom'
import { useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { TheoryReferencePicker } from '@/components/solution/TheoryReferencePicker'
import { useDraft } from '@/components/editor/useDraft'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { createSolution, type SolutionReference } from '@/lib/queries/solutions'
import { setEditorAnswer } from '@/lib/queries/questions'
import { assignUnit } from '@/lib/queries/admin'
import { createUnit, type Unit } from '@/lib/queries/taxonomy'
import { useData } from '@/lib/data'
import { circled, type Choice } from '@/types/question'
import { isEmptyDoc, solutionTemplateDoc, type RichDoc } from '@/types/richtext'
import { formatDateTime } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string
  examId: string
  groupId: string | null
  choices: Choice[]
  /** 이미 편집자답이 있으면 그 값으로 시작한다 (재검토하는 경우) */
  currentEditorAnswer: number[]
  /** 복기 당시 통용됐던 답. 편집자답이 없으면 이 값으로 선택을 미리 채워둔다. */
  yamaAnswer: number[] | null
  /** 현재 분류된 단원. 없으면 미분류 문항이다. */
  currentUnitId: string | null
  /** 'ai_suggested' 면 사람이 아직 확인 안 한 AI 1차 분류라 검토가 필요하다 */
  currentUnitSource: 'ai_suggested' | 'human_confirmed' | null
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
  examId,
  groupId,
  choices,
  currentEditorAnswer,
  yamaAnswer,
  currentUnitId,
  currentUnitSource,
  userId,
}: Props) {
  const navigate = useNavigate()
  const { taxonomy, refreshAll } = useData()
  // 편집자답이 아직 없으면 야마답으로 미리 채워, 편집자가 다시 고를 필요 없이
  // 다르다고 판단할 때만 바꾸도록 한다.
  const initialSelection = currentEditorAnswer.length > 0 ? currentEditorAnswer : (yamaAnswer ?? [])

  const [pickerOpen, setPickerOpen] = useState(initialSelection.length > 0)
  const [selection, setSelection] = useState<number[]>(initialSelection)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [references, setReferences] = useState<SolutionReference[]>([])

  const subjectId = taxonomy?.examById.get(examId)?.subjectId ?? null
  // 화면에서 방금 만든 단원은 다음 taxonomy 새로고침 전까지 여기 따로 들고 있는다.
  const [newUnits, setNewUnits] = useState<Unit[]>([])
  const subjectUnits = subjectId
    ? [...taxonomy!.units.filter((unit) => unit.subjectId === subjectId), ...newUnits]
    : []
  const [unitId, setUnitId] = useState<string | null>(currentUnitId)
  const [unitPickerOpen, setUnitPickerOpen] = useState(false)
  const [addingUnit, setAddingUnit] = useState(false)
  const [newUnitName, setNewUnitName] = useState('')
  const [creatingUnit, setCreatingUnit] = useState(false)
  const [unitError, setUnitError] = useState<string | null>(null)
  const unitName = unitId
    ? (subjectUnits.find((unit) => unit.id === unitId)?.name ??
      taxonomy?.unitById.get(unitId)?.name ??
      '알 수 없는 단원')
    : '미분류'
  // 아직 아무도 안 건드린 AI 1차 분류일 때만 안내를 보여준다. 여기서 바꾸면
  // 저장 시 human_confirmed 로 바뀌므로 다음에 들어오면 안 뜬다.
  const isUnconfirmedAiSuggestion = unitId === currentUnitId && currentUnitSource === 'ai_suggested'

  const draftKey = groupId ?? questionId
  const { savedDraft, schedule, discard } = useDraft({
    userId,
    targetType: 'solution',
    targetKey: draftKey,
    enabled: true,
  })

  const [seed, setSeed] = useState(() => ({ doc: solutionTemplateDoc(choices.length), version: 0 }))
  const [draftDismissed, setDraftDismissed] = useState(false)
  const doc = useRef<RichDoc>(seed.doc)

  function handleChange(next: RichDoc) {
    doc.current = next
    schedule(next)
  }

  async function handleCreateUnit() {
    if (!subjectId) return
    const trimmed = newUnitName.trim()
    if (!trimmed) return

    // DB 유니크 제약이 이름 중복을 막아주긴 하지만, 이미 있는 이름이면 굳이
    // 새로 만들지 않고 그 단원을 바로 선택해준다.
    const existing = subjectUnits.find((unit) => unit.name.trim().toLowerCase() === trimmed.toLowerCase())
    if (existing) {
      setUnitId(existing.id)
      setUnitPickerOpen(false)
      setAddingUnit(false)
      setNewUnitName('')
      return
    }

    setCreatingUnit(true)
    setUnitError(null)
    try {
      const created = await createUnit(subjectId, trimmed, subjectUnits)
      setNewUnits((prev) => [...prev, created])
      setUnitId(created.id)
      setUnitPickerOpen(false)
      setAddingUnit(false)
      setNewUnitName('')
      refreshAll()
    } catch (caught) {
      setUnitError(caught instanceof Error ? caught.message : '단원을 추가하지 못했습니다.')
    } finally {
      setCreatingUnit(false)
    }
  }

  function toggleChoice(no: number) {
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
      if (unitId !== currentUnitId) await assignUnit([questionId], unitId)
      await createSolution({
        target: { questionId, groupId },
        authorId: userId,
        content: doc.current,
        references,
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

      {subjectId !== null && (
        <div className="mb-4">
          <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            단원을 선택해주세요
          </p>
          {!unitPickerOpen ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setUnitPickerOpen(true)}>
                {unitName}
              </Button>
              {isUnconfirmedAiSuggestion && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  AI 1차 분류 · 확인 필요
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              {subjectUnits.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => {
                    setUnitId(unit.id)
                    setUnitPickerOpen(false)
                  }}
                  className={cn(
                    'rounded-lg px-2.5 py-1.5 text-sm transition-colors',
                    unitId === unit.id
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
                  )}
                >
                  {unit.name}
                </button>
              ))}
              {!addingUnit ? (
                <button
                  type="button"
                  onClick={() => setAddingUnit(true)}
                  className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-500 dark:hover:text-brand-400"
                >
                  + 새 단원
                </button>
              ) : (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleCreateUnit()
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    autoFocus
                    type="text"
                    value={newUnitName}
                    onChange={(event) => setNewUnitName(event.target.value)}
                    placeholder="단원 이름"
                    disabled={creatingUnit}
                    className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
                  />
                  <Button type="submit" size="sm" disabled={creatingUnit || newUnitName.trim().length === 0}>
                    추가
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setAddingUnit(false)
                      setNewUnitName('')
                      setUnitError(null)
                    }}
                  >
                    취소
                  </Button>
                </form>
              )}
            </div>
          )}
          {unitError && <p className="mt-1 text-xs text-marker-red">{unitError}</p>}
        </div>
      )}

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
                            'grid h-4 w-4 shrink-0 place-items-center rounded border-2 transition-colors',
                            isSelected
                              ? 'border-brand-600 bg-brand-600'
                              : 'border-slate-300 dark:border-slate-600',
                          )}
                        >
                          {isSelected && <span className="block h-1.5 w-2.5 rounded-[1px] bg-white" />}
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

      <div className="mt-3">
        <TheoryReferencePicker subjectId={subjectId} value={references} onChange={setReferences} />
      </div>

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
