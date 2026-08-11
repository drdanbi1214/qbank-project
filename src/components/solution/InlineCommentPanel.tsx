import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import {
  createInlineComment,
  deleteInlineComment,
  resolveInlineComment,
  type InlineComment,
} from '@/lib/queries/solutions'
import { formatRelative } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  solutionId: string
  comments: InlineComment[]
  /** 풀이 작성자면 해결 처리를 할 수 있다 */
  isSolutionAuthor: boolean
  activeId: string | null
  onActiveChange: (id: string | null) => void
  onChanged: () => void
}

/**
 * 풀이 옆에 붙는 인라인 코멘트 목록.
 * 답글은 2단계까지만 허용된다(DB 트리거로도 막혀 있다).
 */
export function InlineCommentPanel({
  solutionId,
  comments,
  isSolutionAuthor,
  activeId,
  onActiveChange,
  onChanged,
}: Props) {
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id ?? ''
  const [showResolved, setShowResolved] = useState(false)

  const threads = useMemo(() => {
    const roots = comments.filter((item) => item.parentId === null)
    return roots.map((root) => ({
      root,
      replies: comments.filter((item) => item.parentId === root.id),
    }))
  }, [comments])

  const visible = showResolved ? threads : threads.filter((item) => item.root.status === 'open')
  const resolvedCount = threads.length - threads.filter((item) => item.root.status === 'open').length

  if (threads.length === 0) {
    return (
      <p className="text-xs text-slate-400 dark:text-slate-500">
        본문을 드래그하면 그 부분에 코멘트를 남길 수 있습니다.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          코멘트 {threads.length}개
        </h4>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((prev) => !prev)}
            className="text-xs text-slate-400 hover:underline dark:text-slate-500"
          >
            {showResolved ? '해결된 항목 숨기기' : `해결됨 ${resolvedCount}개 보기`}
          </button>
        )}
      </div>

      {visible.map(({ root, replies }) => (
        <CommentThread
          key={root.id}
          root={root}
          replies={replies}
          solutionId={solutionId}
          userId={userId}
          canResolve={isSolutionAuthor || isAdmin || root.author.id === userId}
          canDelete={isAdmin || root.author.id === userId}
          active={activeId === root.id}
          onSelect={() => onActiveChange(activeId === root.id ? null : root.id)}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function CommentThread({
  root,
  replies,
  solutionId,
  userId,
  canResolve,
  canDelete,
  active,
  onSelect,
  onChanged,
}: {
  root: InlineComment
  replies: InlineComment[]
  solutionId: string
  userId: string
  canResolve: boolean
  canDelete: boolean
  active: boolean
  onSelect: () => void
  onChanged: () => void
}) {
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitReply() {
    const trimmed = text.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    try {
      await createInlineComment({
        solutionId,
        authorId: userId,
        parentId: root.id,
        content: trimmed,
      })
      setText('')
      setReplying(false)
      onChanged()
    } catch (caught) {
      console.error('답글을 남기지 못했습니다.', caught)
    } finally {
      setBusy(false)
    }
  }

  async function resolve() {
    try {
      await resolveInlineComment(root.id, userId)
      onChanged()
    } catch (caught) {
      console.error('해결 처리하지 못했습니다.', caught)
    }
  }

  async function remove() {
    if (!window.confirm('코멘트를 삭제할까요?')) return
    try {
      await deleteInlineComment(root.id)
      onChanged()
    } catch (caught) {
      console.error('코멘트를 삭제하지 못했습니다.', caught)
    }
  }

  return (
    <article
      className={cn(
        'rounded-lg border p-2 text-sm transition-colors',
        root.status === 'resolved'
          ? 'border-slate-200 bg-slate-50 opacity-70 dark:border-slate-700 dark:bg-slate-800/50'
          : active
            ? 'border-brand-400 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/30'
            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        {root.selectedText && (
          <p className="mb-1 border-l-2 border-amber-400 pl-2 text-xs text-slate-500 dark:text-slate-400">
            {root.selectedText}
          </p>
        )}
        <p className="whitespace-pre-wrap">{root.content}</p>
        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {root.author.displayName} {formatRelative(root.createdAt)}
          {root.status === 'resolved' && ' 해결됨'}
        </p>
      </button>

      {replies.length > 0 && (
        <ul className="mt-2 space-y-1 border-l-2 border-slate-200 pl-2 dark:border-slate-700">
          {replies.map((reply) => (
            <li key={reply.id}>
              <p className="whitespace-pre-wrap text-sm">{reply.content}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {reply.author.displayName} {formatRelative(reply.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {replying ? (
        <div className="mt-2 space-y-1">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            autoFocus
            placeholder="답글을 입력하세요"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={() => void submitReply()} disabled={busy}>
              등록
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              취소
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="text-slate-500 hover:underline dark:text-slate-400"
          >
            답글 쓰기
          </button>
          {root.status === 'open' && canResolve && (
            <button
              type="button"
              onClick={() => void resolve()}
              className="text-brand-600 hover:underline dark:text-brand-300"
            >
              해결 처리
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => void remove()}
              className="text-rose-600 hover:underline dark:text-rose-400"
            >
              삭제
            </button>
          )}
        </div>
      )}
    </article>
  )
}
