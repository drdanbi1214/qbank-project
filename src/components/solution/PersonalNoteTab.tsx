import { useEffect, useMemo, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { fetchNote, saveNote, type NoteTarget, type PersonalNote } from '@/lib/queries/notes'
import { emptyDoc, type RichDoc } from '@/types/richtext'
import { formatDateTime } from '@/utils/date'

/**
 * 내 노트 탭. 본인만 볼 수 있는 메모라 별도 임시저장 없이 바로 저장한다.
 */
export function PersonalNoteTab({
  questionId,
  groupId,
}: {
  questionId: string
  groupId: string | null
}) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const target = useMemo<NoteTarget>(() => ({ questionId, groupId }), [questionId, groupId])
  const noteKey = groupId ?? questionId

  const embed = useEmbedPickers({ subjectId: null, theory: true })
  const [loaded, setLoaded] = useState<{ key: string; note: PersonalNote | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const doc = useRef<RichDoc>(emptyDoc())

  useEffect(() => {
    let active = true
    void fetchNote(target)
      .then((note) => {
        if (!active) return
        doc.current = note?.content ?? emptyDoc()
        setLoaded({ key: noteKey, note })
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '노트를 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [target, noteKey])

  const ready = loaded?.key === noteKey

  async function save() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      await saveNote({ target, userId, content: doc.current })
      setMessage('저장했습니다.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-8">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <LazyRichTextEditor
        key={noteKey}
        initialValue={loaded.note?.content ?? emptyDoc()}
        onChange={(next) => {
          doc.current = next
        }}
        userId={userId}
        placeholder="나만 보는 메모입니다."
        minHeight="12rem"
        onUploadError={setError}
        onRequestTheory={embed.onRequestTheory}
      />
      {embed.pickers}

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          저장
        </Button>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {message ??
            (loaded.note ? `마지막 저장 ${formatDateTime(loaded.note.updatedAt)}` : '')}
        </span>
      </div>
    </div>
  )
}
