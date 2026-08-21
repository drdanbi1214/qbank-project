import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import { richTextToPlain } from '@/types/richtext'

type Props = {
  /** 이 과목의 이론을 먼저 보여준다. 다른 과목도 검색으로 찾을 수 있다. */
  subjectId: string | null
  onPick: (documentId: string) => void
  onCancel: () => void
}

/**
 * 이미 올라와 있는 이론 문서를 찾아 본문에 꽂는다.
 *
 * 이론은 Notion 에서 임포트한 것이라 제목이 폴더 구조를 따라간다. 그래서 제목만
 * 보면 어느 갈래인지 알기 어려워, 상위 문서를 이어 붙인 경로를 함께 보여준다.
 */
export function TheoryPicker({ subjectId, onPick, onCancel }: Props) {
  const [documents, setDocuments] = useState<TheoryDocument[] | null>(null)
  const [keyword, setKeyword] = useState('')

  useEffect(() => {
    let active = true
    void fetchTheoryDocuments()
      .then((rows) => {
        if (active) setDocuments(rows)
      })
      .catch(() => {
        if (active) setDocuments([])
      })
    return () => {
      active = false
    }
  }, [])

  const results = useMemo(() => {
    const rows = (documents ?? []).filter((row) => row.hasContent)
    const byId = new Map(rows.map((row) => [row.id, row]))

    const pathOf = (row: TheoryDocument): string => {
      const names = [row.title]
      let parent = row.parentId ? byId.get(row.parentId) : undefined
      // 계층이 깊어도 세 단계면 어디 것인지 알아보기에 충분하다.
      while (parent && names.length < 3) {
        names.unshift(parent.title)
        parent = parent.parentId ? byId.get(parent.parentId) : undefined
      }
      return names.join(' › ')
    }

    const needle = keyword.trim().toLowerCase()
    const scoped = rows.filter((row) => !subjectId || row.subjectId === subjectId)
    const pool = needle === '' ? scoped : rows

    return pool
      .filter((row) => {
        if (needle === '') return true
        return (
          row.title.toLowerCase().includes(needle) ||
          richTextToPlain(row.content).toLowerCase().includes(needle)
        )
      })
      .slice(0, 60)
      .map((row) => ({ row, path: pathOf(row) }))
  }, [documents, keyword, subjectId])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white p-4 shadow-xl dark:border-slate-600 dark:bg-slate-900"
      >
        <h3 className="mb-2 text-sm font-semibold">본문에 넣을 알렌 고르기</h3>

        <div className="mb-3 flex gap-2">
          <input
            autoFocus
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="제목이나 내용으로 찾기"
            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
          />
          <Button variant="ghost" size="sm" onClick={onCancel}>
            취소
          </Button>
        </div>

        {documents === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            찾은 알렌 문서가 없습니다.
          </p>
        ) : (
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {results.map(({ row, path }) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onPick(row.id)}
                  className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <span className="block text-sm font-medium">{row.title}</span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                    {path}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
