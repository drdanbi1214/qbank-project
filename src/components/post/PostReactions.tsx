import { useState } from 'react'
import { PostComments } from '@/components/post/PostComments'
import { Icon } from '@/components/ui/Icon'
import { useAuth } from '@/lib/auth'
import { togglePostUpvote, type PostTarget } from '@/lib/queries/postReactions'
import { cn } from '@/utils/cn'

type Props = PostTarget & {
  /** 글쓴이. 자기 글은 추천할 수 없다. */
  authorId: string | null
  upvoteCount: number
  commentCount: number
  upvoted: boolean
}

/**
 * 글 맨 아래의 추천·댓글 줄. 공지와 테마가 같이 쓴다.
 *
 * 추천 알림은 DB 트리거가 보낸다. 껐다 켜도 알림은 한 번만 가고, 글쓴이
 * 자신에게는 가지 않는다.
 */
export function PostReactions({
  kind,
  id,
  authorId,
  upvoteCount,
  commentCount,
  upvoted: initialUpvoted,
}: Props) {
  // 다른 글로 옮기면 부모가 key 를 갈아 끼워 이 컴포넌트를 새로 만든다.
  // 그래서 여기서는 처음 받은 값만 들고 있어도 된다.
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const isAuthor = !!authorId && authorId === userId

  const [upvoted, setUpvoted] = useState(initialUpvoted)
  const [count, setCount] = useState(upvoteCount)
  const [openComments, setOpenComments] = useState(false)
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (!userId || isAuthor || busy) return
    const next = !upvoted
    // 먼저 그려두고 실패하면 되돌린다. 누를 때마다 기다리면 답답하다.
    setUpvoted(next)
    setCount((prev) => prev + (next ? 1 : -1))
    setBusy(true)
    try {
      await togglePostUpvote({ kind, id }, userId, next)
    } catch (caught) {
      setUpvoted(!next)
      setCount((prev) => prev + (next ? -1 : 1))
      console.error('추천을 반영하지 못했습니다.', caught)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={!userId || isAuthor}
          title={isAuthor ? '자기 글은 추천할 수 없습니다.' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm transition-colors',
            upvoted
              ? 'border-emerald-400 bg-emerald-50 font-semibold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-slate-200 text-slate-600 hover:border-emerald-300 dark:border-slate-700 dark:text-slate-300',
            (!userId || isAuthor) && 'cursor-default opacity-60 hover:border-slate-200',
          )}
        >
          <Icon name="thumbs-up" size={16} />
          좋아요 {count}
        </button>

        <button
          type="button"
          onClick={() => setOpenComments((prev) => !prev)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-sm text-slate-600 transition-colors hover:border-emerald-300 dark:border-slate-700 dark:text-slate-300"
        >
          <Icon name="board" size={16} />
          댓글 {commentCount}
        </button>
      </div>

      {openComments && (
        <div className="mt-3">
          <PostComments kind={kind} id={id} />
        </div>
      )}
    </div>
  )
}
