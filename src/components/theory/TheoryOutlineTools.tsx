import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { moveTheoryDocument, type TheoryDocument } from '@/lib/queries/theory'
import { descendantIds } from '@/components/theory/outline'

/**
 * 목차 편집 도구 (관리자 전용).
 *
 * 이론 목차는 원본 폴더 구조를 그대로 가져온 것이라 실제 교재 흐름과 자주
 * 어긋난다. 지금까지는 그때마다 SQL 로 고쳤는데, 관리자가 화면에서 바로
 * 옮길 수 있어야 한다.
 *
 * 순서는 형제끼리 자리 맞바꾸기(↑↓)로만 바꾼다. 끌어놓기는 모바일에서
 * 잘 안 되고 엉뚱한 곳에 떨어뜨리기 쉽다.
 */

export function MoveDialog({
  document,
  all,
  onClose,
  onMoved,
}: {
  document: TheoryDocument
  all: TheoryDocument[]
  onClose: () => void
  onMoved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

  const blocked = useMemo(() => descendantIds(document.id, all), [document.id, all])

  const titleOf = useMemo(() => new Map(all.map((row) => [row.id, row.title])), [all])
  /** 어디로 옮기는지 알아보려면 "소화기 › 3 위장관-식도질환" 처럼 길을 보여줘야 한다. */
  const pathOf = useMemo(() => {
    const parent = new Map(all.map((row) => [row.id, row.parentId]))
    return (id: string) => {
      const parts: string[] = []
      let cursor: string | null = id
      while (cursor) {
        parts.unshift(titleOf.get(cursor) ?? '?')
        cursor = parent.get(cursor) ?? null
      }
      return parts.join(' › ')
    }
  }, [all, titleOf])

  const targets = useMemo(() => {
    const word = keyword.trim().toLowerCase()
    return all
      .filter((row) => !blocked.has(row.id) && row.id !== document.parentId)
      .map((row) => ({ id: row.id, path: pathOf(row.id) }))
      .filter((row) => word === '' || row.path.toLowerCase().includes(word))
      .sort((a, b) => a.path.localeCompare(b.path, 'ko'))
      .slice(0, 60)
  }, [all, blocked, document.parentId, keyword, pathOf])

  async function move(parentId: string | null) {
    setBusy(true)
    setError(null)
    try {
      await moveTheoryDocument(document.id, parentId)
      onMoved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '옮기지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">
          <span className="text-slate-500 dark:text-slate-400">옮길 항목 · </span>
          {document.title}
        </h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          현재 위치 {document.parentId ? pathOf(document.parentId) : '최상위'}
        </p>

        {error && (
          <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="옮길 위치 찾기"
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />

        <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            type="button"
            disabled={busy || document.parentId === null}
            onClick={() => void move(null)}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40 dark:hover:bg-slate-800"
          >
            최상위로 옮기기
          </button>
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              disabled={busy}
              onClick={() => void move(target.id)}
              className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-40 dark:border-slate-800 dark:hover:bg-slate-800"
            >
              {target.path}
            </button>
          ))}
          {targets.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              맞는 위치가 없습니다.
            </p>
          )}
        </div>

        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  )
}
