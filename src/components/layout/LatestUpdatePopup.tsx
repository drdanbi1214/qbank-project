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
const NOTICE_KEY = '2026-09-09-legendob-updates-since-0908-edit-safety'
const SESSION_KEY_PREFIX = 'qbank:update-notice-seen:'
const UPDATES = [
  '게시물 본문에서 원하는 구간을 선택해 나만의 메모를 붙일 수 있습니다. 표시와 연결선은 고른 메모지 색으로 함께 보입니다.',
  '게시물에 들어간 야마와 유사 문제를 그 자리에서 바로 풀고 채점할 수 있습니다. 상단에서 ‘문제 먼저 풀기’와 ‘풀이 한번에 보기’를 바꿀 수 있습니다.',
  '글을 편집할 때 각 문제의 Y답을 바로 확인할 수 있고, 동일·유사 문제 연결과 묶기 해제 동작을 더 안정적으로 다듬었습니다.',
  '게시물 편집 중 다른 글로 이동하면 먼저 확인하고 현재 글에 임시저장합니다. 다른 멤버가 먼저 수정한 글도 그대로 덮어쓰지 않도록 보호합니다.',
  '야마 카드와 전환 버튼·공지·목차 단원을 하늘색 테마로 통일하고, 선지 간격과 노트북 목차 스크롤을 정리했습니다.',
]

/**
 * 레전드옵세스터디 회원이 로그인한 뒤 첫 화면에서 띄우는 계정별 업데이트 안내.
 * 같은 로그인 중에는 한 번만, 영구 숨김을 선택하면 다른 기기에서도 다시 띄우지 않는다.
 */
export function LatestUpdatePopup() {
  const { session, hasPermission } = useAuth()
  const canViewNotice = hasPermission('study_legendob')
  const userId = session?.user.id ?? ''
  const signedInAt = session?.user.last_sign_in_at ?? 'current'
  const sessionKey = `${SESSION_KEY_PREFIX}${userId}:${signedInAt}:${NOTICE_KEY}`
  const [visibleFor, setVisibleFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || !canViewNotice || window.sessionStorage.getItem(sessionKey) === '1') return
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
  }, [canViewNotice, sessionKey, userId])

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

  if (!canViewNotice || visibleFor !== sessionKey) return null

  return (
    <Modal
      title="레옵스 업데이트 (9/8–9/9)"
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
