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
const NOTICE_KEY = '2026-09-15-kmle-cross-subject-search-and-colors'
const SESSION_KEY_PREFIX = 'qbank:update-notice-seen:'
const UPDATES = [
  '이론·테마 본문에서 국시 KMLE 문제를 검색해 바로 첨부할 수 있습니다.',
  '국시 검색은 이제 다른 과목 문제도 함께 찾고, 관련도가 비슷하면 지금 보고 있는 과목을 먼저 보여줍니다.',
  '고른 문제가 마음에 안 들면 다시 검색하지 않고, 미리보기 화면의 ← → 화살표로 검색 결과의 다른 후보를 바로 넘겨볼 수 있습니다.',
  '본문에 넣은 국시 카드는 보라색으로 표시되어 일반 야마 카드와 구분되고, 정답도 노란색으로 바로 표시됩니다.',
  '정신건강의학과·외과총론 국시 문제를 시험 삼아 먼저 넣었습니다. 다른 과목도 순차적으로 업데이트할 예정입니다.',
]

const KMLE_ATTACH_IMAGES = [
  {
    src: '/updates/kmle-attach-2026-09/screenshot-31.png',
    alt: '글쓰기 화면 상단의 국시 버튼',
  },
  {
    src: '/updates/kmle-attach-2026-09/screenshot-27.png',
    alt: '슬래시 명령 메뉴의 국시 버튼',
  },
  {
    src: '/updates/kmle-attach-2026-09/screenshot-21.png',
    alt: '국시 KMLE 문제 유사도 검색 결과',
  },
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
      title="국시 KMLE 첨부 개선 (9/15)"
      wide
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
      <div className="mt-5 space-y-3">
        <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
          툴바의 <strong className="font-semibold text-violet-700 dark:text-violet-300">국시</strong>를 누르거나
          {' '}<strong className="font-semibold text-slate-800 dark:text-slate-100">/ 메뉴</strong>에서 국시를 선택한 뒤,
          문제 내용이나 해설을 붙여 넣으면 가장 비슷한 문제부터 찾을 수 있습니다.
        </p>
        {KMLE_ATTACH_IMAGES.map((image) => (
          <img
            key={image.src}
            src={image.src}
            alt={image.alt}
            loading="eager"
            className="h-auto w-full rounded-xl border border-slate-200 bg-white object-contain shadow-sm dark:border-slate-700"
          />
        ))}
      </div>
      {error && (
        <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          다시 보지 않기 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}
    </Modal>
  )
}
