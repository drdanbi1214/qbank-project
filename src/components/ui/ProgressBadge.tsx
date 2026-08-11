import { accuracy, type Progress } from '@/lib/data'
import { cn } from '@/utils/cn'

/** `Q 15/117` 형태의 진행률 뱃지 + 정답률 */
export function ProgressBadge({
  progress,
  showAccuracy = true,
  className,
}: {
  progress: Progress
  showAccuracy?: boolean
  className?: string
}) {
  const rate = accuracy(progress)

  return (
    <span className={cn('flex shrink-0 items-center gap-2 text-xs tabular-nums', className)}>
      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Q {progress.solved}/{progress.total}
      </span>
      {showAccuracy && rate !== null && (
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
