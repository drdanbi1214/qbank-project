import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  dismissUpdateNotice,
  isUpdateNoticeDismissed,
} from '@/lib/queries/updateNotices'

/** 다음 업데이트 안내를 띄울 때 이 키와 아래 문구를 함께 바꾼다. */
const NOTICE_KEY = '2026-08-24-search-and-annotations'
const SESSION_KEY_PREFIX = 'qbank:update-notice-seen:'

const UPDATES = [
  '문제·풀이·강의록 검색의 여러 단어 인식 방식을 통일했습니다.',
  '정확한 문구와 서로 가까운 검색어가 위에 나오도록 관련도 정렬을 개선했습니다.',
  'PDF에서 글자 사이에 공백이나 줄바꿈이 끼어도 검색되도록 개선했습니다.',
  '검색 결과에서 실제로 일치한 단어가 정확하게 강조되도록 고쳤습니다.',
  '통합 검색에서 강의록만 따로 검색할 수 있는 옵션을 추가했습니다.',
  '검색 중임을 바로 알 수 있도록 검색 로딩 표시를 추가했습니다.',
  '강의록에 넣는 글상자의 배경색과 테두리색을 설정할 수 있게 했습니다.',
  '알렌 본문에 개인 형광펜·빨간 글씨·굵은 글씨를 남길 수 있게 했습니다.',
]

/**
 * 승인된 사용자가 새 버전을 처음 볼 때만 띄우는 계정별 업데이트 안내.
 * 집중 화면(풀이·블록테스트·인쇄)에서 바로 가리지 않고 일반 화면으로 돌아왔을 때 뜬다.
 */
export function LatestUpdatePopup() {
  const { session } = useAuth()
  const location = useLocation()
  const userId = session?.user.id ?? ''
  const sessionKey = `${SESSION_KEY_PREFIX}${userId}:${NOTICE_KEY}`
  const [visible, setVisible] = useState(false)
  const [neverShowAgain, setNeverShowAgain] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId || window.sessionStorage.getItem(sessionKey) === '1') return
    let active = true

    void isUpdateNoticeDismissed(userId, NOTICE_KEY)
      .then((dismissed) => {
        if (active && !dismissed) setVisible(true)
      })
      .catch((caught: unknown) => {
        // 조회가 잠시 실패해도 사용자가 새 기능을 확인할 기회는 남긴다.
        console.error('업데이트 안내 상태를 불러오지 못했습니다.', caught)
        if (active) setVisible(true)
      })

    return () => {
      active = false
    }
  }, [sessionKey, userId])

  const close = useCallback(async () => {
    if (busy) return
    setError(null)

    if (neverShowAgain) {
      setBusy(true)
      try {
        await dismissUpdateNotice(userId, NOTICE_KEY)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '설정을 저장하지 못했습니다.')
        setBusy(false)
        return
      }
      setBusy(false)
    }

    window.sessionStorage.setItem(sessionKey, '1')
    setVisible(false)
  }, [busy, neverShowAgain, sessionKey, userId])

  const focusRoute = ['/solve', '/block-test', '/print'].some((path) =>
    location.pathname.startsWith(path),
  )
  if (!visible || focusRoute) return null

  return (
    <Modal
      title="최신 업데이트입니다 (8/24 15:55)"
      onClose={() => { void close() }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={neverShowAgain}
              onChange={(event) => setNeverShowAgain(event.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            이 업데이트 다시 보지 않기
          </label>
          <Button onClick={() => { void close() }} disabled={busy}>
            {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
            확인
          </Button>
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
