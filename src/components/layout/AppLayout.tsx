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

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <Header />
      <main
        className={cn(
          'mx-auto px-3 pb-24 pt-4 sm:px-4 lg:pb-10',
          wideContent ? 'max-w-[100rem]' : 'max-w-7xl',
        )}
      >
        <Outlet />
        <BuildFooter />
      </main>
      <MobileTabBar />
    </div>
  )
}
