import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'

/**
 * 로그인 후 계정마다 한 번 뜨는 공지 팝업. "다시는 보지 않기" 를 체크하고
 * 닫아야만 이후 로그인에서 다시 뜨지 않는다 (profiles.welcome_popup_dismissed).
 */
export function WelcomePopup() {
  const { profile } = useAuth()
  const [closed, setClosed] = useState(false)

  if (!profile || profile.welcome_popup_dismissed || closed) return null

  return <WelcomePopupModal onClose={() => setClosed(true)} />
}

function WelcomePopupModal({ onClose }: { onClose: () => void }) {
  const { updateProfile } = useAuth()
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [busy, setBusy] = useState(false)

  async function close() {
    if (!dontShowAgain) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await updateProfile({ welcome_popup_dismissed: true })
    } finally {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl dark:bg-slate-900">
        <img
          src="/welcome-popup.png"
          alt="공지"
          className="w-full rounded-xl"
        />

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
          />
          다시는 보지 않기
        </label>

        <Button className="mt-3 w-full" onClick={() => void close()} disabled={busy}>
          닫기
        </Button>
      </div>
    </div>
  )
}
