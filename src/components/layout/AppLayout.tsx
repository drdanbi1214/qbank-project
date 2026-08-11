import { Outlet } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { MobileTabBar } from '@/components/layout/MobileTabBar'

/**
 * 공통 셸. 웹은 상단 헤더 + 콘텐츠, 모바일은 하단 탭바를 추가한다.
 * 좌측 사이드바가 필요한 화면(학습하기)은 각 페이지에서 Sidebar 를 조합한다.
 */
export function AppLayout() {
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <Header />
      <main className="mx-auto max-w-7xl px-3 pb-24 pt-4 sm:px-4 lg:pb-10">
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  )
}
