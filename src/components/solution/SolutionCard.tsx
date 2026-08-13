import { useState } from 'react'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { MarkableRegion } from '@/components/marking/MarkableRegion'
import { useTextMarks } from '@/components/marking/useTextMarks'
import type { RenderMark, SelectionRange } from '@/components/marking/marks'
import { InlineCommentPanel } from '@/components/solution/InlineCommentPanel'
import { SolutionHistoryModal } from '@/components/solution/SolutionHistoryModal'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { useSignedUrl } from '@/lib/storage'
import {
  createInlineComment,
  deleteSolution,
  toggleSolutionUpvote,
  type InlineComment,
  type Solution,
} from '@/lib/queries/solutions'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

type Props = {
  solution: Solution
  comments: InlineComment[]
  /** 추천순 목록에서 맨 위에 고정된 풀이 */
  isBest: boolean
  onEdit: () => void
  onChanged: () => void
  onCommentsChanged: () => void
}

export function SolutionCard({
  solution,
  comments,
  isBest,
  onEdit,
  onChanged,
  onCommentsChanged,
}: Props) {
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id ?? ''
  const isAuthor = solution.author.id === userId

  const { marks: myMarks, apply, erase } = useTextMarks('solution', solution.id)
  const [pending, setPending] = useState<SelectionRange | null>(null)
  const [commentText, setCommentText] = useState('')
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [upvoted, setUpvoted] = useState(solution.upvoted)
  const [upvoteCount, setUpvoteCount] = useState(solution.upvoteCount)
  const [busy, setBusy] = useState(false)
  const hasCommentThreads = comments.some((item) => item.parentId === null)

  // 인라인 코멘트와 내 형광펜을 한 목록으로 합쳐 본문에 그린다.
  const commentMarks: RenderMark[] = comments
    .filter((item) => item.parentId === null && item.anchorFrom !== null && item.anchorTo !== null)
    .map((item) => ({
      id: item.id,
      from: item.anchorFrom as number,
      to: item.anchorTo as number,
      style: 'comment' as const,
      resolved: item.status === 'resolved',
    }))

  async function addComment() {
    const trimmed = commentText.trim()
    if (!pending || trimmed === '' || busy) return
    setBusy(true)
    try {
      await createInlineComment({
        solutionId: solution.id,
        authorId: userId,
        selectedText: pending.text.slice(0, 200),
        anchorFrom: pending.from,
        anchorTo: pending.to,
        content: trimmed,
      })
      setPending(null)
      setCommentText('')
      window.getSelection()?.removeAllRanges()
      onCommentsChanged()
    } catch (caught) {
      console.error('코멘트를 남기지 못했습니다.', caught)
    } finally {
      setBusy(false)
    }
  }

  async function toggleUpvote() {
    if (isAuthor) return
    const next = !upvoted
    setUpvoted(next)
    setUpvoteCount((prev) => prev + (next ? 1 : -1))
    try {
      await toggleSolutionUpvote(solution.id, userId, next)
    } catch (caught) {
      setUpvoted(!next)
      setUpvoteCount((prev) => prev + (next ? -1 : 1))
      console.error('추천을 반영하지 못했습니다.', caught)
    }
  }

  async function remove() {
    if (!window.confirm('풀이를 삭제할까요? 되돌릴 수 없습니다.')) return
    try {
      await deleteSolution(solution.id)
      onChanged()
    } catch (caught) {
      console.error('풀이를 삭제하지 못했습니다.', caught)
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        {isBest && (
          <span className="rounded bg-brand-600 px-1.5 py-0.5 text-xs font-semibold text-white">
            베스트
          </span>
        )}
        {solution.isVerified && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            검수 완료
          </span>
        )}
        <Avatar path={solution.author.avatarUrl} name={solution.author.displayName} size={24} />
        <span className="font-semibold">{solution.author.displayName}</span>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatShortDate(solution.createdAt)}
        </span>
        {solution.editedAt && (
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
          >
            수정됨 {formatShortDate(solution.editedAt)}
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {(isAuthor || isAdmin) && (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                수정
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove()}>
                삭제
              </Button>
            </>
          )}
        </div>
      </header>

      <div
        className={cn(
          'gap-5',
          hasCommentThreads && 'lg:grid lg:grid-cols-[1fr_16rem]',
        )}
      >
        <div className="min-w-0">
          {!hasCommentThreads && (
            <p className="mb-2 text-right text-xs text-slate-400 dark:text-slate-500">
              본문을 드래그하면 그 부분에 코멘트를 남길 수 있습니다.
            </p>
          )}
          <MarkableRegion
            onApply={apply}
            onErase={erase}
            onAsk={(range) => setPending(range)}
          >
            <RichTextViewer
              doc={solution.content}
              className="solution-rich-text"
              marks={[...myMarks, ...commentMarks]}
              activeMarkId={activeCommentId}
              onMarkClick={setActiveCommentId}
            />
          </MarkableRegion>

          {solution.references.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
              <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">관련 단원 · 알렌</p>
              <div className="flex flex-wrap gap-1.5">
                {solution.references.map((reference) => reference.url && <SolutionReferenceLink key={reference.url} reference={reference} />)}
              </div>
            </div>
          )}

          {pending && (
            <div className="mt-3 rounded-lg border border-brand-300 bg-brand-50 p-3 dark:border-brand-700 dark:bg-brand-900/30">
              <p className="mb-1 border-l-2 border-amber-400 pl-2 text-xs text-slate-600 dark:text-slate-300">
                {pending.text.length > 120 ? `${pending.text.slice(0, 120)}…` : pending.text}
              </p>
              <textarea
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                rows={2}
                autoFocus
                placeholder="이 부분에 남길 코멘트"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
              />
              <div className="mt-1 flex gap-1">
                <Button size="sm" onClick={() => void addComment()} disabled={busy}>
                  코멘트 달기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                  취소
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => void toggleUpvote()}
              disabled={isAuthor}
              title={isAuthor ? '본인 풀이는 추천할 수 없습니다' : '추천'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50',
                upvoted
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-slate-300 text-slate-600 hover:border-brand-400 dark:border-slate-600 dark:text-slate-300',
              )}
            >
              👍 추천 {upvoteCount}
            </button>
          </div>
        </div>

        {hasCommentThreads && (
          <aside className="mt-5 border-t border-slate-200 pt-3 lg:mt-0 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 dark:border-slate-700">
            <InlineCommentPanel
              solutionId={solution.id}
              comments={comments}
              isSolutionAuthor={isAuthor}
              activeId={activeCommentId}
              onActiveChange={setActiveCommentId}
              onChanged={onCommentsChanged}
            />
          </aside>
        )}
      </div>

      {showHistory && (
        <SolutionHistoryModal solutionId={solution.id} onClose={() => setShowHistory(false)} />
      )}
    </article>
  )
}

function SolutionReferenceLink({ reference }: { reference: Solution['references'][number] }) {
  const signedUrl = useSignedUrl(reference.kind === 'lecture' ? reference.url : null)
  const href = reference.kind === 'lecture' ? signedUrl : reference.url
  return href ? <a href={href} target="_blank" rel="noreferrer" className="rounded-lg bg-brand-50 px-2 py-1 text-brand-700 hover:underline dark:bg-brand-900/40 dark:text-brand-200">{reference.kind === 'lecture' ? '강의록 · ' : ''}{reference.label}</a> : null
}
