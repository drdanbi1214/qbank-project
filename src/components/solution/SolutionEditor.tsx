import { useCallback, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { collectLectureReferences } from '@/lib/queries/lectures'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { TheoryReferencePicker } from '@/components/solution/TheoryReferencePicker'
import { SolutionScopePicker } from '@/components/solution/SolutionScope'
import { UnitPicker } from '@/components/question/UnitPicker'
import { useDraft } from '@/components/editor/useDraft'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { assignUnit } from '@/lib/queries/admin'
import {
  createSolution,
  updateSolution,
  type Solution,
  type SolutionTarget,
} from '@/lib/queries/solutions'
import { formatDateTime } from '@/utils/date'
import { isEmptyDoc, solutionTemplateDoc, type RichDoc } from '@/types/richtext'

type Props = {
  target: SolutionTarget
  userId: string
  /** 값이 있으면 수정, 없으면 새 풀이 */
  existing?: Solution | null
  choiceCount: number
  onSaved: () => void
  onCancel: () => void
  subjectId: string | null
  /** 현재 분류된 단원. 없으면 미분류 문항이다. */
  currentUnitId: string | null
  /** 'ai_suggested' 면 사람이 아직 확인 안 한 AI 1차 분류라 검토가 필요하다 */
  currentUnitSource: 'ai_suggested' | 'human_confirmed' | null
}

export function SolutionEditor({
  target,
  userId,
  existing,
  choiceCount,
  onSaved,
  onCancel,
  subjectId,
  currentUnitId,
  currentUnitSource,
}: Props) {
  const isNew = !existing
  const { profile, updateProfile } = useAuth()
  const embed = useEmbedPickers({ subjectId: subjectId, theory: true, lectureUserId: userId })
  const [unitId, setUnitId] = useState<string | null>(currentUnitId)
  // 새 풀이는 마지막에 쓴 공개범위로 시작한다. 수정할 때는 그 풀이의 값을 그대로 쓴다.
  const [scope, setScope] = useState<string | null>(
    existing ? existing.requiredPermission : (profile?.default_solution_permission ?? null),
  )
  const isUnconfirmedAiSuggestion = unitId === currentUnitId && currentUnitSource === 'ai_suggested'
  // 그룹이 있으면 그룹 단위로 임시저장한다. 같은 문제의 다른 학번에서 이어 쓸 수 있다.
  const draftKey = target.groupId ?? target.questionId

  const { savedDraft, status, schedule, discard } = useDraft({
    userId,
    targetType: 'solution',
    targetKey: draftKey,
    enabled: isNew,
  })

  // 에디터는 비제어라 내용을 갈아끼울 때만 version 을 올려 다시 마운트한다.
  const [seed, setSeed] = useState(() => ({
    doc: existing?.content ?? solutionTemplateDoc(choiceCount),
    version: 0,
  }))
  const [draftDismissed, setDraftDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [references, setReferences] = useState(existing?.references ?? [])

  const doc = useRef<RichDoc>(seed.doc)

  const handleChange = useCallback(
    (next: RichDoc) => {
      doc.current = next
      schedule(next)
      // 본문에 강의록 쪽을 넣으면 아래 "관련 단원" 에도 저절로 잡히게 한다.
      // 이미 있는 줄은 건드리지 않고, 사용자가 지운 것을 되살리지도 않도록
      // 본문에 있는데 목록에 없는 것만 더한다.
      setReferences((prev) => {
        const known = new Set(prev.map((item) => item.url))
        const added = collectLectureReferences(next).filter((item) => !known.has(item.url))
        return added.length > 0 ? [...prev, ...added] : prev
      })
    },
    [schedule],
  )

  async function save() {
    if (isEmptyDoc(doc.current)) {
      setError('내용을 입력해주세요.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      if (unitId !== currentUnitId) await assignUnit([target.questionId], unitId)
      if (existing) {
        await updateSolution({
          id: existing.id,
          content: doc.current,
          references,
          requiredPermission: scope,
        })
      } else {
        await createSolution({
          target,
          authorId: userId,
          content: doc.current,
          references,
          requiredPermission: scope,
        })
        await discard()
      }

      // 다음 작성의 기본값으로 쓰려고 방금 고른 범위를 기억해둔다.
      // 실패해도 풀이는 이미 저장됐으므로 저장 자체를 실패로 만들지 않는다.
      if (scope !== (profile?.default_solution_permission ?? null)) {
        await updateProfile({ default_solution_permission: scope }).catch((caught: unknown) =>
          console.error('기본 공개범위를 저장하지 못했습니다.', caught),
        )
      }

      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const showDraftNotice = isNew && savedDraft !== null && !draftDismissed

  return (
    <div className="space-y-3">
      {showDraftNotice && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          <span>
            {formatDateTime(savedDraft.updatedAt)}에 저장된 작성 중인 내용이 있습니다.
          </span>
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

      <UnitPicker
        subjectId={subjectId}
        unitId={unitId}
        onChange={setUnitId}
        unconfirmedAiSuggestion={isUnconfirmedAiSuggestion}
      />

      <SolutionScopePicker value={scope} onChange={setScope} disabled={busy} />

      <LazyRichTextEditor
        key={seed.version}
        initialValue={seed.doc}
        onChange={handleChange}
        userId={userId}
        placeholder="풀이를 작성해주세요. 이미지는 붙여넣기로 바로 올릴 수 있습니다."
        minHeight="18rem"
        onUploadError={setError}
        onRequestTheory={embed.onRequestTheory}
        onRequestLecture={embed.onRequestLecture}
      />
      {embed.pickers}
      <TheoryReferencePicker subjectId={subjectId} value={references} onChange={setReferences} />

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          {existing ? '수정 저장' : '등록'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          취소
        </Button>

        {isNew && (
          <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
            {status === 'saving'
              ? '임시저장 중'
              : status === 'saved'
                ? '임시저장됨'
                : status === 'failed'
                  ? '임시저장 실패'
                  : '5초마다 자동 임시저장'}
          </span>
        )}
      </div>
    </div>
  )
}
