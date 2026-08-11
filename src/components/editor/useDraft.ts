import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deleteDraft,
  fetchDraft,
  saveDraft,
  type Draft,
  type DraftTarget,
} from '@/lib/queries/drafts'
import type { RichDoc } from '@/types/richtext'

const DEBOUNCE_MS = 5000

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * 작성 중 내용을 5초 debounce 로 drafts 테이블에 넣어둔다.
 *
 * 새로고침이나 실수로 창을 닫아도 복구할 수 있어야 하므로, 마지막 저장은
 * 언마운트 시점에도 한 번 더 밀어 넣는다. 저장이 끝난 글은 discard 로 지운다.
 */
export function useDraft(params: {
  userId: string
  targetType: DraftTarget
  /** 문제 id 또는 그룹 id. 대상이 정해지지 않았으면 null */
  targetKey: string | null
  /** 이미 등록된 글을 수정하는 중이면 임시저장하지 않는다 */
  enabled: boolean
}) {
  const { userId, targetType, targetKey, enabled } = params

  const [existing, setExisting] = useState<{ key: string; draft: Draft | null } | null>(null)
  const [status, setStatus] = useState<DraftStatus>('idle')

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<RichDoc | null>(null)
  // 언마운트 정리 함수가 최신 값을 보도록 ref 에 담는다.
  const config = useRef({ userId, targetType, targetKey, enabled })
  useEffect(() => {
    config.current = { userId, targetType, targetKey, enabled }
  }, [userId, targetType, targetKey, enabled])

  // 기존 임시저장 불러오기 (복구 안내용)
  useEffect(() => {
    if (!enabled || !targetKey) return
    let active = true
    void fetchDraft(targetType, targetKey)
      .then((draft) => {
        if (active) setExisting({ key: targetKey, draft })
      })
      .catch((caught: unknown) => {
        console.error('임시저장을 불러오지 못했습니다.', caught)
        if (active) setExisting({ key: targetKey, draft: null })
      })
    return () => {
      active = false
    }
  }, [targetType, targetKey, enabled])

  const flush = useCallback(async () => {
    const { userId: uid, targetType: type, targetKey: key, enabled: on } = config.current
    const doc = pending.current
    if (!on || !key || !doc) return

    pending.current = null
    setStatus('saving')
    try {
      await saveDraft({ userId: uid, targetType: type, targetKey: key, content: doc })
      setStatus('saved')
    } catch (caught) {
      console.error('임시저장에 실패했습니다.', caught)
      setStatus('failed')
    }
  }, [])

  const schedule = useCallback(
    (doc: RichDoc) => {
      if (!config.current.enabled || !config.current.targetKey) return
      pending.current = doc
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), DEBOUNCE_MS)
    },
    [flush],
  )

  /** 등록이 끝났거나 사용자가 버렸을 때 호출한다. */
  const discard = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    pending.current = null
    const { targetType: type, targetKey: key } = config.current
    if (!key) return
    try {
      await deleteDraft(type, key)
      setExisting({ key, draft: null })
      setStatus('idle')
    } catch (caught) {
      console.error('임시저장을 지우지 못했습니다.', caught)
    }
  }, [])

  // 창을 닫거나 화면을 벗어나도 마지막 입력을 잃지 않도록 한 번 더 저장한다.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      void flush()
    }
  }, [flush])

  return {
    /** 열었을 때 남아 있던 임시저장. 없으면 null */
    savedDraft: enabled && targetKey && existing?.key === targetKey ? existing.draft : null,
    status,
    schedule,
    discard,
  }
}
