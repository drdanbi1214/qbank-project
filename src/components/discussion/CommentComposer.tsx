import { useCallback, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { useDraft } from '@/components/editor/useDraft'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { createReply, updateReply } from '@/lib/queries/discussions'
import { emptyDoc, isEmptyDoc, type RichDoc } from '@/types/richtext'
import { formatDateTime } from '@/utils/date'

const PLACEHOLDER = '명예훼손, 무단광고, 불법정보 유포 시 삭제 될 수 있습니다.'

type Props = {
  discussionId: string
  userId: string
  /** 값이 있으면 대댓글 */
  parentId?: string | null
  /** 값이 있으면 기존 댓글 수정 */
  editing?: { id: string; content: RichDoc } | null
  onDone: () => void
  onCancel?: () => void
  autoFocus?: boolean
}

export function CommentComposer({
  discussionId,
  userId,
  parentId = null,
  editing = null,
  onDone,
  onCancel,
}: Props) {
  // 원댓글 입력만 임시저장한다. 답글이나 수정은 그 자리에서 끝나는 짧은 입력이다.
  const draftEnabled = !editing && parentId === null
  const { savedDraft, schedule, discard } = useDraft({
    userId,
    targetType: 'discussion',
    targetKey: discussionId,
    enabled: draftEnabled,
  })

  const embed = useEmbedPickers({ subjectId: null, theory: true })
  const [seed, setSeed] = useState(() => ({
    doc: editing?.content ?? emptyDoc(),
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

  async function submit() {
    if (isEmptyDoc(doc.current)) {
      setError('내용을 입력해주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        await updateReply(editing.id, doc.current)
      } else {
        await createReply({ discussionId, authorId: userId, parentId, content: doc.current })
        if (draftEnabled) await discard()
      }
      // 등록 후 입력창을 비운다.
      setSeed((prev) => ({ doc: emptyDoc(), version: prev.version + 1 }))
      doc.current = emptyDoc()
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const showDraftNotice = draftEnabled && savedDraft !== null && !draftDismissed

  return (
    <div className="space-y-2">
      {showDraftNotice && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
          <span>{formatDateTime(savedDraft.updatedAt)}에 쓰던 댓글이 있습니다.</span>
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
        placeholder={PLACEHOLDER}
        compact
        onUploadError={setError}
        onRequestTheory={embed.onRequestTheory}
      />
      {embed.pickers}

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        )}
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          등록
        </Button>
      </div>
    </div>
  )
}
