import { useRef, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { LatestUpdatePopup } from '@/components/layout/LatestUpdatePopup'
import { useAuth } from '@/lib/auth'
import { uploadAvatar } from '@/lib/uploads'

/**
 * 프로필 사진이 없으면 화면 전체를 가리는 모달을 띄운다.
 *
 * 배경 클릭이나 esc 로 닫을 수 없고, 사진을 올려야만 사라진다. ApprovedRoute
 * 아래 전체를 감싸서 학습/풀이/인쇄 화면을 포함한 모든 승인된 화면에서 걸린다.
 */
export function RequireAvatar() {
  const { profile } = useAuth()

  return (
    <>
      <Outlet />
      {profile && !profile.avatar_url ? <AvatarGateModal /> : null}
      {profile?.avatar_url ? <LatestUpdatePopup /> : null}
    </>
  )
}

function AvatarGateModal() {
  const { profile, updateProfile } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function pickAvatar(file: File) {
    if (!profile) return
    setError(null)
    setBusy(true)
    try {
      const path = await uploadAvatar(file, profile.id)
      await updateProfile({ avatar_url: path })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '사진을 올리지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-slate-900">
        <Avatar path={null} name={profile?.display_name ?? null} size={72} className="mx-auto" />
        <h2 className="mt-4 text-base font-bold">프로필 사진을 등록해주세요</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          이제부터 프로필 사진 등록이 필수입니다. 사진을 올려야 계속 이용할 수 있습니다.
        </p>

        <Button
          className="mt-5 w-full"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
        >
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          사진 선택하기
        </Button>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void pickAvatar(file)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
