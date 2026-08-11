import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'

/** 로그인하지 않으면 어떤 화면도 볼 수 없다. */
export function ProtectedRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

/** 관리자 승인 전에는 대기 화면으로 보낸다. */
export function ApprovedRoute() {
  const { isPending } = useAuth()
  if (isPending) return <Navigate to="/pending" replace />
  return <Outlet />
}

/** 관리자 전용 화면 */
export function AdminRoute() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/study" replace />
  return <Outlet />
}
