import { useSignedUrl } from '@/lib/storage'
import { cn } from '@/utils/cn'

type Props = {
  /** `avatars/<user_id>/<file>` 형태의 저장 경로 */
  path: string | null | undefined
  name: string | null | undefined
  /** 지름 (px) */
  size?: number
  className?: string
}

/**
 * 프로필 사진. 등록한 사진이 없으면 닉네임 첫 글자를 보여준다.
 * 버킷이 비공개라 표시할 때 서명 URL 을 받아온다.
 */
export function Avatar({ path, name, size = 28, className }: Props) {
  const url = useSignedUrl(path)
  const initial = name?.trim().slice(0, 1) || '?'

  if (url) {
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
