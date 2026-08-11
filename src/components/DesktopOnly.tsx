import type { ReactNode } from 'react'

/**
 * 편집 계열 화면(문제 등록, 일괄 업로드, PDF 검수)은 웹 전용이다.
 * 모바일 폭에서는 안내만 보여준다.
 */
export function DesktopOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-center text-sm text-amber-900 lg:hidden dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        이 화면은 편집 작업용이라 PC에서 이용해주세요.
      </div>
      <div className="hidden lg:block">{children}</div>
    </>
  )
}
