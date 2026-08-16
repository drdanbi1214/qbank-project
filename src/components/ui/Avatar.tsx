import { useEffect, useState } from 'react'
import { useSignedUrl } from '@/lib/storage'
import { cn } from '@/utils/cn'

type Props = {
  /** `avatars/<user_id>/<file>` 형태의 저장 경로 */
  path: string | null | undefined
  name: string | null | undefined
  /** 지름 (px) */
  size?: number
  className?: string
  /** 클릭하면 원본 크기로 확대해서 보여준다 (사진이 있을 때만 동작) */
  enlargeOnClick?: boolean
}

/**
 * 프로필 사진. 등록한 사진이 없으면 닉네임 첫 글자를 보여준다.
 * 버킷이 비공개라 표시할 때 서명 URL 을 받아온다.
 */
export function Avatar({ path, name, size = 28, className, enlargeOnClick = false }: Props) {
  const url = useSignedUrl(path)
  const initial = name?.trim().slice(0, 1) || '?'
  const [expanded, setExpanded] = useState(false)

  if (url) {
    if (!enlargeOnClick) {
      return (
        <img
          src={url}
          alt={name ?? '프로필 사진'}
          width={size}
          height={size}
          style={{ width: size, height: size }}
          className={cn('shrink-0 rounded-full object-cover', className)}
        />
      )
    }

    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`${name ?? '프로필'} 사진 확대해서 보기`}
          className="shrink-0 cursor-zoom-in rounded-full"
        >
          <img
            src={url}
            alt={name ?? '프로필 사진'}
            width={size}
            height={size}
            style={{ width: size, height: size }}
            className={cn('shrink-0 rounded-full object-cover', className)}
          />
        </button>
        {expanded && (
          <AvatarLightbox url={url} name={name} onClose={() => setExpanded(false)} />
        )}
      </>
    )
  }

  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-slate-200 font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100',
        className,
      )}
    >
      {initial}
    </span>
  )
}

function AvatarLightbox({
  url,
  name,
  onClose,
}: {
  url: string
  name: string | null | undefined
  onClose: () => void
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
      <img
        src={url}
        alt={name ?? '프로필 사진'}
        className="max-h-[85vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  )
}
