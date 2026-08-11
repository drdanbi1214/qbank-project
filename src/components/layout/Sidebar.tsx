import type { ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/utils/cn'

type SidebarProps = {
  title?: string
  children: ReactNode
  /** 모바일에서 드로어로 열려 있는지 */
  open?: boolean
  onClose?: () => void
}

/**
 * 학습 화면 좌측 사이드바. 웹에서는 고정, 모바일에서는 드로어로 전환한다.
 */
export function Sidebar({ title = '과목', children, open = false, onClose }: SidebarProps) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="사이드바 닫기"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 border-r border-slate-200 bg-white transition-transform duration-200 lg:sticky lg:top-14 lg:z-0 lg:h-[calc(100dvh-3.5rem)] lg:translate-x-0 dark:border-slate-800 dark:bg-slate-950',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4 lg:hidden dark:border-slate-800">
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="사이드바 닫기"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="h-[calc(100%-3.5rem)] overflow-y-auto p-3 lg:h-full">{children}</div>
      </aside>
    </>
  )
}
