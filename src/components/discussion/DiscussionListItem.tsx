import type { DiscussionListItem as Item } from '@/lib/queries/discussions'
import { formatShortDate } from '@/utils/date'
import { cn } from '@/utils/cn'

/**
 * 게시글 목록 한 줄.
 * 문제 화면 하단 임베드 목록과 게시판 탭이 같은 컴포넌트를 쓴다.
 */
export function DiscussionListItem({
  item,
  selected,
  showCategory,
  onSelect,
}: {
  item: Item
  selected?: boolean
  /** 게시판 탭처럼 여러 분류가 섞이는 목록에서만 분류 배지를 보인다 */
  showCategory?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'block w-full px-1 py-3 text-left transition-colors',
        selected
          ? 'bg-brand-50 dark:bg-brand-900/30'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
      )}
    >
      <div className="flex items-center gap-1.5">
        {showCategory && (
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {item.category}
          </span>
        )}
        {item.status === 'resolved' && (
          <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
            해결됨
          </span>
        )}
        <h3 className="truncate font-semibold">{item.title}</h3>
      </div>

      {item.preview && (
        <p className="mt-0.5 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">
          {item.preview}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-400 dark:text-slate-500">
        <span>조회수 {item.viewCount}</span>
        <span>|</span>
        <span>댓글 {item.replyCount}</span>
        <span>|</span>
        <span>추천수 {item.upvoteCount}</span>
        <span className="ml-auto">
          {item.author.displayName} | {formatShortDate(item.createdAt)}
        </span>
      </div>
    </button>
  )
}
