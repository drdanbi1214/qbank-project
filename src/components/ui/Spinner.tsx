import { cn } from '@/utils/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-slate-700 dark:border-t-brand-400',
        className,
      )}
    />
  )
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}
