import type { Progress } from '@/lib/data'
import { cn } from '@/utils/cn'

/** 전체 중 몇 %를 풀었는지. 정답률이 아니라 진행도다. */
function progressRate(progress: Progress): number | null {
  if (progress.total === 0) return null
  return Math.round((progress.solved / progress.total) * 100)
}

/** `Q 15/117` 형태의 진행률 뱃지 + 진행도(%) */
export function ProgressBadge({
  progress,
  showRate = true,
  className,
}: {
  progress: Progress
  showRate?: boolean
  className?: string
}) {
  const rate = progressRate(progress)

  return (
    <span className={cn('flex shrink-0 items-center gap-2 text-xs tabular-nums', className)}>
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Q {progress.solved}/{progress.total}
      </span>
      {showRate && rate !== null && (
        <span
          className={cn(
            'font-medium',
            rate >= 80
              ? 'text-emerald-600 dark:text-emerald-400'
              : rate >= 50
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-rose-600 dark:text-rose-400',
          )}
        >
          {rate}%
        </span>
      )}
    </span>
  )
}

export function ProgressBar({ progress }: { progress: Progress }) {
  const ratio = progress.total === 0 ? 0 : Math.round((progress.solved / progress.total) * 100)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div
        className="h-full rounded-full bg-brand-500 transition-[width]"
        style={{ width: `${ratio}%` }}
      />
    </div>
  )
}
