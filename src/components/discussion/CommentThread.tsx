import { useState } from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { CommentComposer } from '@/components/discussion/CommentComposer'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/lib/auth'
import {
  acceptReply,
  deleteReply,
  toggleReplyUpvote,
  type Reply,
} from '@/lib/queries/discussions'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  discussionId: string
  replies: Reply[]
  /** 원글 작성자만 답변을 채택할 수 있다 */
  isDiscussionAuthor: boolean
  onChanged: () => void
}

export function CommentThread({
  discussionId,
  replies,
  isDiscussionAuthor,
  onChanged,
}: Props) {
  const total = countReplies(replies)

  return (
    <section>
      <h3 className="mb-2 text-sm font-bold">댓글 {total}개</h3>

      {replies.length === 0 ? (
        <p className="py-4 text-sm text-slate-500 dark:text-slate-400">
          아직 댓글이 없습니다.
        </p>
      ) : (
        <ul>
          {replies.map((reply, index) => (
            <li
              key={reply.id}
              className={cn('py-3', index > 0 && 'border-t border-slate-100 dark:border-slate-800/70')}
            >
              <ReplyItem
                reply={reply}
                discussionId={discussionId}
                isDiscussionAuthor={isDiscussionAuthor}
                onChanged={onChanged}
              />

              {reply.children.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {reply.children.map((child) => (
                    <li
                      key={child.id}
                      className="rounded-lg bg-slate-50 p-2 pl-3 dark:bg-slate-800/50"
                    >
                      <ReplyItem
                        reply={child}
                        discussionId={discussionId}
                        isDiscussionAuthor={isDiscussionAuthor}
                        // 깊이 2단계까지만 허용하므로 대댓글에는 답글 입력을 열지 않는다.
                        canReply={false}
                        onChanged={onChanged}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function countReplies(replies: Reply[]): number {
  return replies.reduce(
    (sum, reply) => sum + (reply.isDeleted ? 0 : 1) + reply.children.filter((c) => !c.isDeleted).length,
    0,
  )
}

function ReplyItem({
  reply,
  discussionId,
  isDiscussionAuthor,
  canReply = true,
  onChanged,
}: {
  reply: Reply
  discussionId: string
  isDiscussionAuthor: boolean
  canReply?: boolean
  onChanged: () => void
}) {
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id ?? ''
  const isAuthor = reply.author.id === userId

  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [upvoted, setUpvoted] = useState(reply.upvoted)
  const [upvoteCount, setUpvoteCount] = useState(reply.upvoteCount)

  if (reply.isDeleted) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">삭제된 댓글입니다.</p>
  }

  async function toggleUpvote() {
    if (isAuthor) return
    const next = !upvoted
    setUpvoted(next)
    setUpvoteCount((prev) => prev + (next ? 1 : -1))
    try {
      await toggleReplyUpvote(reply.id, userId, next)
    } catch (caught) {
      setUpvoted(!next)
      setUpvoteCount((prev) => prev + (next ? -1 : 1))
      console.error('추천을 반영하지 못했습니다.', caught)
    }
  }

  async function remove() {
    if (!window.confirm('댓글을 삭제할까요?')) return
    try {
      await deleteReply(reply.id)
      onChanged()
    } catch (caught) {
      console.error('댓글을 삭제하지 못했습니다.', caught)
    }
  }

  async function accept() {
    try {
      await acceptReply({ discussionId, replyId: reply.id, userId })
      onChanged()
    } catch (caught) {
      console.error('답변을 채택하지 못했습니다.', caught)
    }
  }

  if (editing) {
    return (
      <CommentComposer
        discussionId={discussionId}
        userId={userId}
        editing={{ id: reply.id, content: reply.content }}
        onDone={() => {
          setEditing(false)
          onChanged()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {reply.isAccepted && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            채택된 답변
          </span>
        )}
        <Avatar path={reply.author.avatarUrl} name={reply.author.displayName} size={22} />
        <span className="text-sm font-semibold">{reply.author.displayName}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatShortDate(reply.createdAt)}
        </span>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => void toggleUpvote()}
            disabled={isAuthor}
            className={cn(
              'transition-colors disabled:opacity-50',
              upvoted
                ? 'font-semibold text-brand-600 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400',
            )}
          >
            👍 추천 {upvoteCount}
          </button>
          {(isAuthor || isAdmin) && (
            <>
              {isAuthor && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-slate-500 hover:underline dark:text-slate-400"
                >
                  수정
                </button>
              )}
              <button
                type="button"
                onClick={() => void remove()}
                className="text-rose-600 hover:underline dark:text-rose-400"
              >
                삭제
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-1">
        <RichTextViewer doc={reply.content} className="text-sm" />
      </div>

      <div className="mt-1 flex justify-end gap-2 text-xs">
        {isDiscussionAuthor && !isAuthor && !reply.isAccepted && (
          <button
            type="button"
            onClick={() => void accept()}
            className="text-emerald-700 hover:underline dark:text-emerald-300"
          >
            답변 채택
          </button>
        )}
        {canReply && (
          <button
            type="button"
            onClick={() => setReplying((prev) => !prev)}
            className="text-slate-500 hover:underline dark:text-slate-400"
          >
            답글 쓰기
          </button>
        )}
      </div>

      {replying && (
        <div className="mt-2">
          <CommentComposer
            discussionId={discussionId}
            userId={userId}
            parentId={reply.id}
            onDone={() => {
              setReplying(false)
              onChanged()
            }}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
    </div>
  )
}
