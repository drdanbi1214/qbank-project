import { useEffect, useRef, type ReactNode } from 'react'
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
  // onClose 는 호출부에서 대부분 인라인 화살표 함수라 렌더마다 새 함수다. 잠금
  // effect 가 여기에 딸려 있으면 렌더마다 정리와 실행이 번갈아 돌면서, 되돌릴
  // 값으로 들고 있던 previous 가 직전 실행이 넣은 'hidden' 으로 덮인다. 그러면
  // 모달을 닫은 뒤에도 body 가 hidden 으로 남아 페이지 전체가 스크롤되지 않는다.
  // 잠금은 열리고 닫힐 때 한 번씩만 해야 하므로 Esc 처리와 분리한다.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  // Esc 는 최신 onClose 를 불러야 하니 ref 로 받아 effect 를 다시 걸지 않는다.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
