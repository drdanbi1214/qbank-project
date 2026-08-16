import { useState } from 'react'
import { cn } from '@/utils/cn'

/**
 * 서비스 로고.
 *
 * public/brand-logo.png 를 쓰고, 파일이 없거나 깨지면 예전 Q 타일로 되돌린다.
 * 이미지 하나 때문에 헤더가 깨진 아이콘으로 보이는 일이 없도록 한 장치다.
 */
export function BrandMark({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <span
        className={cn(
          'grid place-items-center rounded-lg bg-brand-600 font-bold text-white',
          className,
        )}
      >
        Q
      </span>
    )
  }

  return (
    <img
      src="/brand-logo.png"
      alt="DALLEN'S LIBRARY"
      onError={() => setFailed(true)}
      className={cn('object-contain', className)}
    />
  )
}

/** 헤더, 로그인 화면에 함께 쓰는 서비스 이름 */
export const BRAND_NAME = "DALLEN'S LIBRARY"

/** BRAND_NAME 에 함께 적용하는 로고 색상/자간 스타일 */
export const BRAND_NAME_CLASSNAME =
  'font-sans font-extrabold uppercase tracking-wide text-brand-600 dark:text-brand-400'
