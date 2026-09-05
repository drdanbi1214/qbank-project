import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BuildFooter } from '@/components/layout/BuildFooter'
import { Header } from '@/components/layout/Header'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { cn } from '@/utils/cn'

/**
 * 공통 셸. 웹은 상단 헤더 + 콘텐츠, 모바일은 하단 탭바를 추가한다.
 * 좌측 사이드바가 필요한 화면(학습하기)은 각 페이지에서 Sidebar 를 조합한다.
 */
export function AppLayout() {
  const location = useLocation()
  const wideContent = location.pathname.startsWith('/topics')
  const lectureReader = /^\/lectures\/(?!c\/)[^/]+\/?$/.test(location.pathname)

  useEffect(() => {
    if (!lectureReader) return
    const previousBodyOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    const previousBodyOverscroll = document.body.style.overscrollBehavior
    const previousRootOverscroll = document.documentElement.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    document.documentElement.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousRootOverflow
      document.body.style.overscrollBehavior = previousBodyOverscroll
      document.documentElement.style.overscrollBehavior = previousRootOverscroll
    }
  }, [lectureReader])

  return (
    <div
      className={cn(
        'bg-slate-50 dark:bg-slate-950',
        lectureReader ? 'h-dvh overflow-hidden overscroll-none' : 'min-h-dvh',
      )}
    >
      <Header />
      <main
        className={cn(
          'mx-auto px-3 pt-4 sm:px-4',
          lectureReader
            ? 'h-[calc(100dvh-3.5rem)] overflow-hidden pb-16 lg:pb-4'
            : 'pb-24 lg:pb-10',
          wideContent ? 'max-w-[100rem]' : 'max-w-7xl',
        )}
      >
        <Outlet />
        {!lectureReader && <BuildFooter />}
      </main>
      <MobileTabBar />
    </div>
  )
}
