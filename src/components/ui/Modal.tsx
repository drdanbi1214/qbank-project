import { useEffect, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/utils/cn'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  /** 본문이 긴 모달은 넓게 연다 */
  wide?: boolean
  footer?: ReactNode
}

export function Modal({ title, onClose, children, wide, footer }: Props) {
  // 열려 있는 동안 배경 스크롤을 막고 Esc 로 닫는다.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          'flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-base font-bold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>

        {footer && (
          <footer className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
