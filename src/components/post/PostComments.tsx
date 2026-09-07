import { useCallback, useEffect, useRef, useState } from 'react'
import { LazyRichTextEditor } from '@/components/editor/LazyRichTextEditor'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { useEmbedPickers } from '@/components/editor/useEmbedPickers'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  createPostComment,
  deletePostComment,
  fetchPostComments,
  updatePostComment,
  type PostComment,
  type PostTarget,
} from '@/lib/queries/postReactions'
import { emptyDoc, isEmptyDoc, type RichDoc } from '@/types/richtext'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

const PLACEHOLDER = '명예훼손, 무단광고, 불법정보 유포 시 삭제 될 수 있습니다.'

/**
 * 게시물 댓글.
 *
 * 게시판의 CommentThread 는 채택과 댓글별 추천에 묶여 있어 그대로 쓰지 못한다.
 * 게시물 댓글에는 그 두 가지가 없으므로 편집기만 공유하고 따로 그린다.
 * 깊이는 DB 트리거가 2단계로 막으므로 대댓글에는 답글 입력을 열지 않는다.
 */
export function PostComments({ kind, id }: PostTarget) {
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id ?? ''
  const [comments, setComments] = useState<PostComment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetchPostComments({ kind, id })
      .then((rows) => {
        setComments(rows)
        setError(null)
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : '댓글을 불러오지 못했습니다.')
      })
  }, [kind, id])

  useEffect(load, [load])

  if (error) {
    return <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
  }
  if (comments === null) {
    return <div className="py-3"><Spinner className="h-5 w-5" /></div>
  }

  return (
    <div className="space-y-3">
      {comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentRow
                comment={comment}
                kind={kind} id={id}
                userId={userId}
                isAdmin={isAdmin}
                onChanged={load}
              />
              {comment.children.length > 0 && (
                <ul className="mt-2 space-y-2 pl-6">
                  {comment.children.map((child) => (
                    <li
                      key={child.id}
                      className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50"
                    >
                      <CommentRow
                        comment={child}
                        kind={kind} id={id}
                        userId={userId}
                        isAdmin={isAdmin}
                        canReply={false}
                        onChanged={load}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {userId && <Composer kind={kind} id={id} userId={userId} onDone={load} />}
    </div>
  )
}

function CommentRow({
  comment,
  kind,
  id,
  userId,
  isAdmin,
  canReply = true,
  onChanged,
}: {
  comment: PostComment
  kind: PostTarget['kind']
  id: string
  userId: string
  isAdmin: boolean
  canReply?: boolean
  onChanged: () => void
}) {
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)

  if (comment.isDeleted) {
    return <p className="text-sm text-slate-400 dark:text-slate-500">삭제된 댓글입니다.</p>
  }

  const canManage = comment.author.id === userId || isAdmin

  async function remove() {
    if (!window.confirm('댓글을 삭제할까요?')) return
    try {
      await deletePostComment({ kind, id }, comment.id)
      onChanged()
    } catch (caught) {
      console.error('댓글을 삭제하지 못했습니다.', caught)
    }
  }

  if (editing) {
    return (
      <Composer
        kind={kind} id={id}
        userId={userId}
        editing={{ id: comment.id, content: comment.content }}
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
        <Avatar path={comment.author.avatarUrl} name={comment.author.displayName} size={22} />
        <span className="text-sm font-semibold">{comment.author.displayName}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatShortDate(comment.createdAt)}
        </span>
        <span className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          {canReply && userId && (
            <button
              type="button"
              onClick={() => setReplying((prev) => !prev)}
              className="underline hover:text-brand-600 dark:hover:text-brand-300"
            >
              답글
            </button>
          )}
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="underline hover:text-brand-600 dark:hover:text-brand-300"
              >
                수정
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                className="underline hover:text-rose-600 dark:hover:text-rose-400"
              >
                삭제
              </button>
            </>
          )}
        </span>
      </div>

      <div className="mt-1 text-sm">
        <RichTextViewer doc={comment.content} />
      </div>

      {replying && (
        <div className="mt-2">
          <Composer
            kind={kind} id={id}
            userId={userId}
            parentId={comment.id}
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

function Composer({
  kind,
  id,
  userId,
  parentId = null,
  editing = null,
  onDone,
  onCancel,
}: {
  kind: PostTarget['kind']
  id: string
  userId: string
  parentId?: string | null
  editing?: { id: string; content: RichDoc } | null
  onDone: () => void
  onCancel?: () => void
}) {
  const embed = useEmbedPickers({ subjectId: null, theory: true, lectureUserId: userId })
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const doc = useRef<RichDoc>(editing?.content ?? emptyDoc())

  async function submit() {
    if (isEmptyDoc(doc.current)) {
      setError('내용을 입력해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        await updatePostComment({ kind, id }, editing.id, doc.current)
      } else {
        await createPostComment({
          target: { kind, id },
          authorId: userId,
          parentId,
          content: doc.current,
        })
        // 등록한 뒤 입력칸을 비운다. 안 비우면 같은 글이 두 번 올라간다.
        doc.current = emptyDoc()
        setVersion((prev) => prev + 1)
      }
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '댓글을 저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <LazyRichTextEditor
        key={version}
        initialValue={editing?.content ?? emptyDoc()}
        onChange={(next) => { doc.current = next }}
        userId={userId}
        placeholder={PLACEHOLDER}
        compact
        onUploadError={setError}
        onRequestTheory={embed.onRequestTheory}
        onRequestLecture={embed.onRequestLecture}
      />
      {embed.pickers}

      {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

      <div className={cn('flex justify-end gap-2')}>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        )}
        <Button size="sm" onClick={() => void submit()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          {editing ? '수정' : '등록'}
        </Button>
      </div>
    </div>
  )
}
