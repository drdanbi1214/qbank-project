import { useCallback, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { LinkedQuestionCard } from '@/components/discussion/LinkedQuestionCard'
import {
  DISCUSSION_CATEGORIES,
  createDiscussion,
  updateDiscussion,
  type Discussion,
  type DiscussionCategory,
} from '@/lib/queries/discussions'
import { emptyDoc, isEmptyDoc, type RichDoc } from '@/types/richtext'

type Props = {
  userId: string
  /** 문제 화면에서 열면 그 문제가 자동으로 첨부된다 */
  questionId: string | null
  questionUnitId?: string | null
  questionStem?: string | null
  existing?: Discussion | null
  /** 본문에서 드래그해 Q 를 누른 경우 그 문장을 인용으로 깔아준다 */
  initialQuote?: string | null
  onSaved: (id: string) => void
  onCancel: () => void
}

/** 인용문을 인용 블록으로 깔고 그 아래에 빈 문단을 둔다. */
function quotedDoc(quote: string): RichDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: quote }] }],
      },
      { type: 'paragraph' },
    ],
  }
}

export function DiscussionComposer({
  userId,
  questionId,
  questionUnitId = null,
  questionStem = null,
  existing = null,
  initialQuote = null,
  onSaved,
  onCancel,
}: Props) {
  const seed = existing?.content ?? (initialQuote ? quotedDoc(initialQuote) : emptyDoc())
  const [category, setCategory] = useState<DiscussionCategory>(existing?.category ?? '해설질문')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = useRef<RichDoc>(seed)
  const handleChange = useCallback((next: RichDoc) => {
    doc.current = next
  }, [])

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900'

  async function save() {
    const trimmedTitle = title.trim()
    if (trimmedTitle === '') {
      setError('제목을 입력해주세요.')
      return
    }
    if (isEmptyDoc(doc.current)) {
      setError('내용을 입력해주세요.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const payload = {
        category,
        title: trimmedTitle,
        content: doc.current,
        confusionPoint: null,
      }

      if (existing) {
        await updateDiscussion({ id: existing.id, ...payload })
        onSaved(existing.id)
      } else {
        const id = await createDiscussion({ authorId: userId, questionId, ...payload })
        onSaved(id)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '등록하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-base font-bold">{existing ? '게시글 수정' : '게시글 작성'}</h2>

      {questionId && (
        <LinkedQuestionCard
          questionId={questionId}
          unitId={questionUnitId}
          stem={questionStem}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {DISCUSSION_CATEGORIES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={
              category === item
                ? 'rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white'
                : 'rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300'
            }
          >
            {item}
          </button>
        ))}
      </div>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="제목"
        maxLength={120}
        className={inputClass}
      />

      <LazyRichTextEditor
        initialValue={seed}
        onChange={handleChange}
        userId={userId}
        placeholder="궁금한 점을 적어주세요. 이미지는 붙여넣기로 바로 올릴 수 있습니다."
        minHeight="14rem"
        onUploadError={setError}
      />

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          {existing ? '수정 저장' : '등록'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          취소
        </Button>
      </div>
    </div>
  )
}
