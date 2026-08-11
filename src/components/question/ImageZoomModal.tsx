import { useEffect } from 'react'
import { Icon } from '@/components/ui/Icon'

type Props = {
  src: string
  caption?: string | null
  onClose: () => void
}

/** 문제 이미지 확대 보기. 휠 및 핀치 줌은 브라우저 기본 동작에 맡긴다. */
export function ImageZoomModal({ src, caption, onClose }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption ?? '이미지 확대'}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/90"
    >
      <div className="flex items-center justify-between p-3 text-white">
        <span className="truncate text-sm">{caption}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white/10"
        >
          <Icon name="close" />
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="flex flex-1 cursor-zoom-out items-center justify-center overflow-auto p-4"
      >
        <img
          src={src}
          alt={caption ?? '문제 이미지'}
          className="max-h-full max-w-full object-contain"
        />
      </button>
    </div>
  )
}
