import { useCallback, useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  dismissUpdateNotice,
  isUpdateNoticeDismissed,
} from '@/lib/queries/updateNotices'

/** 다음 업데이트 안내를 띄울 때 이 키와 아래 문구를 함께 바꾼다. */
const NOTICE_KEY = '2026-09-10-editor-slash-commands-and-callouts'
const SESSION_KEY_PREFIX = 'qbank:update-notice-seen:'
const UPDATES = [
  '글 작성 중 /를 입력하면 야마·알렌·강의록 삽입 명령을 작은 팝업에서 고르고 Enter로 바로 실행할 수 있습니다.',
  '/callout 또는 /콜아웃을 입력하면 중요한 내용을 담는 💡 콜아웃 상자를 넣을 수 있습니다.',
  '/따라서·/왜냐면은 ∴·∵로, =/=·<=·\\>= 같은 입력은 ≠·≤·≥ 기호로 빠르게 바뀝니다.',
  'alpha·beta·gamma를 입력하면 후보 팝업이 뜨고, Enter를 눌러 α·β·γ를 넣을 수 있습니다.',
]

/**
 * 모든 승인 회원이 로그인한 뒤 첫 화면에서 띄우는 계정별 업데이트 안내.
 * 같은 로그인 중에는 한 번만, 영구 숨김을 선택하면 다른 기기에서도 다시 띄우지 않는다.
 */
export function LatestUpdatePopup() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const signedInAt = session?.user.last_sign_in_at ?? 'current'
  const sessionKey = `${SESSION_KEY_PREFIX}${userId}:${signedInAt}:${NOTICE_KEY}`
  const [visibleFor, setVisibleFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || window.sessionStorage.getItem(sessionKey) === '1') return
    let active = true

    void isUpdateNoticeDismissed(userId, NOTICE_KEY)
      .then((dismissed) => {
        if (active && !dismissed) setVisibleFor(sessionKey)
      })
      .catch((caught: unknown) => {
        // 조회가 잠시 실패해도 사용자가 새 기능을 확인할 기회는 남긴다.
        console.error('업데이트 안내 상태를 불러오지 못했습니다.', caught)
        if (active) setVisibleFor(sessionKey)
      })

    return () => {
      active = false
    }
  }, [sessionKey, userId])

  const close = useCallback(() => {
    window.sessionStorage.setItem(sessionKey, '1')
    setVisibleFor(null)
  }, [sessionKey])

  const dismissForever = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await dismissUpdateNotice(userId, NOTICE_KEY)
      setBusy(false)
      close()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '설정을 저장하지 못했습니다.')
      setBusy(false)
    }
  }, [busy, close, userId])

  if (visibleFor !== sessionKey) return null

  return (
    <Modal
      title="새로운 글쓰기 기능 (9/10)"
      onClose={() => {
        if (!busy) close()
      }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => {
              void dismissForever()
            }}
            disabled={busy}
          >
            {busy && <Spinner className="h-4 w-4" />}
            다시 보지 않기
          </Button>
          <Button onClick={close} disabled={busy}>확인</Button>
        </div>
      }
    >
      <ul className="space-y-2.5 text-sm leading-6 text-slate-700 dark:text-slate-200">
        {UPDATES.map((update) => (
          <li key={update} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
            <span>{update}</span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          다시 보지 않기 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}
    </Modal>
  )
}
