import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'

export function PendingApprovalPage() {
  const { profile, signOut, refreshProfile } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-xl font-bold">승인 대기 중입니다</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          {profile?.email} 계정으로 가입되었습니다.
          <br />
          관리자가 승인하면 문제 풀이와 풀이 작성을 이용할 수 있습니다.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => void refreshProfile()}>
            승인 상태 새로고침
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              void signOut().then(() => navigate('/login', { replace: true }))
            }}
          >
            로그아웃
          </Button>
        </div>
      </div>
    </div>
  )
}
