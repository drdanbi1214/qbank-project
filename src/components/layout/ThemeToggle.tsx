import { Icon } from '@/components/ui/Icon'
import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { resolved, toggle } = useTheme()
  const nextLabel = resolved === 'dark' ? '밝은 화면으로 전환' : '어두운 화면으로 전환'

  return (
    <button
      type="button"
      onClick={toggle}
      title={nextLabel}
      aria-label={nextLabel}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <Icon name={resolved === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}
