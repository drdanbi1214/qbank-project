import { useCallback, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useDraft } from '@/components/editor/useDraft'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
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
}

export function SolutionEditor({ target, userId, existing, choiceCount, onSaved, onCancel }: Props) {
  const isNew = !existing
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

  const doc = useRef<RichDoc>(seed.doc)

  const handleChange = useCallback(
    (next: RichDoc) => {
      doc.current = next
      schedule(next)
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
      if (existing) {
        await updateSolution({ id: existing.id, content: doc.current, references: [] })
      } else {
        await createSolution({
          target,
          authorId: userId,
          content: doc.current,
          references: [],
        })
        await discard()
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

      <LazyRichTextEditor
        key={seed.version}
        initialValue={seed.doc}
        onChange={handleChange}
        userId={userId}
        placeholder="풀이를 작성해주세요. 이미지는 붙여넣기로 바로 올릴 수 있습니다."
        minHeight="18rem"
        onUploadError={setError}
      />

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
