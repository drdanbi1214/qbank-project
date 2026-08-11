import { useCallback, useEffect, useState } from 'react'
import type { MarkStyle, RenderMark, SelectionRange } from '@/components/marking/marks'
import { useAuth } from '@/lib/auth'
import {
  createMark,
  deleteMarksInRange,
  fetchMarks,
  type MarkTargetType,
  type TextMarkRow,
} from '@/lib/queries/marks'

/**
 * 한 대상(문제 본문, 원본 해설, 풀이 하나)에 걸린 내 형광펜을 관리한다.
 *
 * 계정에 저장하므로 다른 기기에서 로그인해도 그대로 보인다.
 * 반응 속도를 위해 화면에는 먼저 반영하고 저장이 실패하면 되돌린다.
 */
export function useTextMarks(targetType: MarkTargetType, targetId: string) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [rows, setRows] = useState<TextMarkRow[]>([])

  useEffect(() => {
    if (!targetId) return
    let active = true

    void fetchMarks([targetId])
      .then((loaded) => {
        // 문제 본문과 원본 해설은 같은 id 를 쓰므로 종류로 한 번 더 거른다.
        if (active) setRows(loaded.filter((row) => row.targetType === targetType))
      })
      .catch((caught: unknown) => console.error('표시를 불러오지 못했습니다.', caught))

    return () => {
      active = false
    }
  }, [targetType, targetId])

  const apply = useCallback(
    (range: SelectionRange, style: MarkStyle) => {
      if (!userId) return

      const optimistic: TextMarkRow = {
        id: `pending-${crypto.randomUUID()}`,
        targetType,
        targetId,
        from: range.from,
        to: range.to,
        style,
        selectedText: range.text,
      }
      setRows((prev) => [...prev, optimistic])

      void createMark({
        userId,
        targetType,
        targetId,
        from: range.from,
        to: range.to,
        style,
        selectedText: range.text,
      })
        .then((saved) => {
          setRows((prev) => prev.map((row) => (row.id === optimistic.id ? saved : row)))
        })
        .catch((caught: unknown) => {
          setRows((prev) => prev.filter((row) => row.id !== optimistic.id))
          console.error('표시를 저장하지 못했습니다.', caught)
        })
    },
    [userId, targetType, targetId],
  )

  /** 선택 영역과 겹치는 표시를 모두 지운다. */
  const erase = useCallback(
    (range: SelectionRange) => {
      const overlaps = (row: TextMarkRow) => row.from < range.to && row.to > range.from
      const removed = rows.filter(overlaps)
      if (removed.length === 0) return

      setRows((prev) => prev.filter((row) => !overlaps(row)))

      void deleteMarksInRange({
        targetType,
        targetId,
        from: range.from,
        to: range.to,
      }).catch((caught: unknown) => {
        setRows((prev) => [...prev, ...removed])
        console.error('표시를 지우지 못했습니다.', caught)
      })
    },
    [rows, targetType, targetId],
  )

  const marks: RenderMark[] = rows.map((row) => ({
    id: row.id,
    from: row.from,
    to: row.to,
    style: row.style,
  }))

  return { marks, apply, erase }
}
