import { useCallback, useEffect, useState } from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { CommentComposer } from '@/components/discussion/CommentComposer'
import { CommentThread } from '@/components/discussion/CommentThread'
import { DiscussionComposer } from '@/components/discussion/DiscussionComposer'
import { LinkedQuestionCard } from '@/components/discussion/LinkedQuestionCard'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import {
  deleteDiscussion,
  fetchDiscussion,
  fetchDiscussionRevisions,
  fetchReplies,
  markDiscussionViewed,
  toggleDiscussionBookmark,
  toggleDiscussionUpvote,
  type Discussion,
  type DiscussionRevision,
  type Reply,
} from '@/lib/queries/discussions'
import { submitReport } from '@/lib/queries/reports'
import { formatDateTime, formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  discussionId: string
  /** 목록으로 돌아가기. 모바일 전체화면에서만 필요하다. */
  onBack?: () => void
  /** 웹에서는 목록이 옆에 계속 보이므로 돌아가기 버튼을 감춘다 */
  backOnMobileOnly?: boolean
  onDeleted: () => void
}

/**
 * 게시글 상세. 문제 화면 임베드와 게시판 탭이 같은 컴포넌트를 쓴다.
 */
export function DiscussionDetail({
  discussionId,
  onBack,
  backOnMobileOnly = false,
  onDeleted,
}: Props) {
  const { session, isAdmin } = useAuth()
  const { taxonomy } = useData()
  const userId = session?.user.id ?? ''

  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    discussion: Discussion | null
    replies: Reply[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const requestKey = `${discussionId}|${reloadKey}`
  const ready = loaded?.key === requestKey

  useEffect(() => {
    let active = true

    async function load() {
      try {
        // 세션 안에서 한 번만 조회수를 올린다. 올렸으면 그 값이 반영되도록 뒤에 읽는다.
        await markDiscussionViewed(discussionId)
        const discussion = await fetchDiscussion(discussionId, userId)
        const replies = discussion ? await fetchReplies(discussionId, userId) : []
        if (!active) return
        setLoaded({ key: requestKey, discussion, replies })
        setError(null)
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '게시글을 불러오지 못했습니다.')
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [discussionId, userId, requestKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  if (error) {
    return (
      <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
        {error}
      </p>
    )
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  const discussion = loaded.discussion
  if (!discussion) {
    return (
      <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        삭제되었거나 없는 글입니다.
      </p>
    )
  }

  if (editing) {
    return (
      <DiscussionComposer
        userId={userId}
        questionId={discussion.questionId}
        questionUnitId={discussion.questionUnitId}
        questionStem={discussion.questionStem}
        existing={discussion}
        onSaved={() => {
          setEditing(false)
          reload()
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const isAuthor = discussion.author.id === userId
  const unitName = discussion.questionUnitId
    ? (taxonomy?.unitById.get(discussion.questionUnitId)?.name ?? null)
    : null

  return (
    <article>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'mb-2 text-sm text-slate-500 hover:underline dark:text-slate-400',
            backOnMobileOnly && 'lg:hidden',
          )}
        >
          {'< 돌아가기'}
        </button>
      )}

      <header>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {unitName && (
              <p className="text-xs text-slate-400 dark:text-slate-500">{unitName}</p>
            )}
            <h1 className="text-lg font-bold">{discussion.title}</h1>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <BookmarkButton
              discussionId={discussion.id}
              userId={userId}
              initial={discussion.bookmarked}
            />
            {isAuthor && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                수정
              </Button>
            )}
            {isAdmin && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (!window.confirm('게시글을 삭제할까요?')) return
                  void deleteDiscussion(discussion.id)
                    .then(onDeleted)
                    .catch((caught: unknown) =>
                      console.error('게시글을 삭제하지 못했습니다.', caught),
                    )
                }}
              >
                삭제
              </Button>
            )}
            {!isAuthor && (
              <ReportButton targetId={discussion.id} userId={userId} />
            )}
          </div>
        </div>

        <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
          {discussion.author.displayName} | 조회 {discussion.viewCount} |{' '}
          {formatShortDate(discussion.createdAt)}
          {discussion.contentEditedAt && (
            <>
              {' | '}
              {formatDateTime(discussion.contentEditedAt)} 수정됨{' '}
              <RevisionsButton discussionId={discussion.id} />
            </>
          )}
        </p>
      </header>

      <hr className="my-3 border-slate-200 dark:border-slate-700" />

      {discussion.questionId && (
        <div className="mb-3">
          <LinkedQuestionCard
            questionId={discussion.questionId}
            unitId={discussion.questionUnitId}
            stem={discussion.questionStem}
          />
        </div>
      )}

      <RichTextViewer doc={discussion.content} />

      <div className="my-5 flex justify-center">
        <UpvoteButton
          discussionId={discussion.id}
          userId={userId}
          initial={discussion.upvoted}
          initialCount={discussion.upvoteCount}
          disabled={isAuthor}
        />
      </div>

      <section className="mb-5">
        <h3 className="mb-2 text-sm font-bold">댓글 쓰기</h3>
        <CommentComposer discussionId={discussion.id} userId={userId} onDone={reload} />
      </section>

      <CommentThread
        discussionId={discussion.id}
        replies={loaded.replies}
        isDiscussionAuthor={isAuthor}
        onChanged={reload}
      />

      {onBack && (
        <div className={cn('mt-6 flex justify-center', backOnMobileOnly && 'lg:hidden')}>
          <Button variant="secondary" onClick={onBack}>
            목록
          </Button>
        </div>
      )}
    </article>
  )
}

function UpvoteButton({
  discussionId,
  userId,
  initial,
  initialCount,
  disabled,
}: {
  discussionId: string
  userId: string
  initial: boolean
  initialCount: number
  disabled: boolean
}) {
  const [on, setOn] = useState(initial)
  const [count, setCount] = useState(initialCount)

  async function toggle() {
    if (disabled) return
    const next = !on
    setOn(next)
    setCount((prev) => prev + (next ? 1 : -1))
    try {
      await toggleDiscussionUpvote(discussionId, userId, next)
    } catch (caught) {
      setOn(!next)
      setCount((prev) => prev + (next ? -1 : 1))
      console.error('추천을 반영하지 못했습니다.', caught)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={disabled}
      title={disabled ? '본인 글은 추천할 수 없습니다' : '추천'}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50',
        on
          ? 'border-brand-600 bg-brand-600 text-white'
          : 'border-slate-300 text-slate-600 hover:border-brand-400 dark:border-slate-600 dark:text-slate-300',
      )}
    >
      👍 추천 {count}
    </button>
  )
}

function BookmarkButton({
  discussionId,
  userId,
  initial,
}: {
  discussionId: string
  userId: string
  initial: boolean
}) {
  const [on, setOn] = useState(initial)

  async function toggle() {
    const next = !on
    setOn(next)
    try {
      await toggleDiscussionBookmark(discussionId, userId, next)
    } catch (caught) {
      setOn(!next)
      console.error('북마크를 저장하지 못했습니다.', caught)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      title={on ? '북마크 해제' : '북마크'}
      aria-label={on ? '북마크 해제' : '북마크'}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-base',
        on ? 'text-amber-500' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

function RevisionsButton({ discussionId }: { discussionId: string }) {
  const [open, setOpen] = useState(false)
  const [revisions, setRevisions] = useState<DiscussionRevision[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  function show() {
    setOpen(true)
    if (revisions !== null) return
    void fetchDiscussionRevisions(discussionId)
      .then(setRevisions)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '이전 버전을 불러오지 못했습니다.')
      })
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="text-brand-600 hover:underline dark:text-brand-300"
      >
        이전 버전 보기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4 text-left shadow-xl dark:bg-slate-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">수정 전 버전</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-slate-500 hover:underline dark:text-slate-400"
              >
                닫기
              </button>
            </div>

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </p>
            )}

            {!error && revisions === null && (
              <div className="flex justify-center py-6">
                <Spinner className="h-5 w-5" />
              </div>
            )}

            {revisions !== null && revisions.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                이전 버전이 없습니다.
              </p>
            )}

            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {revisions?.map((revision) => (
                <li key={revision.id} className="py-3 first:pt-0">
                  <p className="mb-1 text-xs text-slate-400 dark:text-slate-500">
                    {formatDateTime(revision.editedAt)} 이전 내용
                  </p>
                  <p className="text-sm font-semibold">{revision.title}</p>
                  <div className="mt-1">
                    <RichTextViewer doc={revision.content} className="text-sm" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

function ReportButton({ targetId, userId }: { targetId: string; userId: string }) {
  const [sent, setSent] = useState(false)

  async function report() {
    const reason = window.prompt('신고 사유를 입력해주세요.')
    if (!reason || reason.trim() === '') return
    try {
      await submitReport({
        reporterId: userId,
        targetType: 'discussion',
        targetId,
        reason: reason.trim(),
      })
      setSent(true)
    } catch (caught) {
      console.error('신고를 접수하지 못했습니다.', caught)
    }
  }

  return (
    <Button size="sm" variant="ghost" onClick={() => void report()} disabled={sent}>
      {sent ? '신고됨' : '신고'}
    </Button>
  )
}
