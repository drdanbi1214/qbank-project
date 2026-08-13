import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import type { SolutionReference } from '@/lib/queries/solutions'

type Props = {
  subjectId: string | null
  value: SolutionReference[]
  onChange: (next: SolutionReference[]) => void
}

type Result = { document: TheoryDocument; titleMatch: boolean }

export function TheoryReferencePicker({ subjectId, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [documents, setDocuments] = useState<TheoryDocument[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !subjectId || documents.length > 0) return
    setLoading(true)
    void fetchTheoryDocuments(subjectId)
      .then(setDocuments)
      .finally(() => setLoading(false))
  }, [open, subjectId, documents.length])

  const results = useMemo<Result[]>(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return []
    const matches = documents
      .filter((document) => document.hasContent)
      .map((document) => {
        const titleMatch = document.title.toLowerCase().includes(keyword)
        const bodyMatch = JSON.stringify(document.content).toLowerCase().includes(keyword)
        return { document, titleMatch, bodyMatch }
      })
      .filter((item) => item.titleMatch || item.bodyMatch)
      .sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || a.document.title.localeCompare(b.document.title, 'ko'))
      .slice(0, 20)
    return matches.map(({ document, titleMatch }) => ({ document, titleMatch }))
  }, [documents, query])

  if (!subjectId) return null

  function add(document: TheoryDocument) {
    const url = `/theory/${subjectId}/${document.id}`
    if (!value.some((reference) => reference.url === url)) onChange([...value, { label: document.title, url }])
    setQuery('')
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">관련 단원 선택</span>
        <span className="text-xs text-slate-400">알렌</span>
        <Button size="sm" variant="secondary" onClick={() => setOpen((current) => !current)}>
          + 추가
        </Button>
        <span className="text-xs text-slate-400">선택하지 않아도 저장할 수 있습니다.</span>
      </div>

      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {value.map((reference) => (
            <li key={reference.url} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-sm text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
              <Link to={reference.url ?? '#'} target="_blank" className="hover:underline">{reference.label}</Link>
              <button type="button" aria-label={`${reference.label} 삭제`} onClick={() => onChange(value.filter((item) => item.url !== reference.url))}>×</button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이론 제목 또는 내용 검색"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
          />
          {loading ? <p className="mt-2 text-xs text-slate-400">이론을 불러오는 중…</p> : query.trim() && (
            <ul className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
              {results.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">검색 결과가 없습니다.</li> : results.map(({ document, titleMatch }) => (
                <li key={document.id}>
                  <button type="button" onClick={() => add(document)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                    <span>{document.title}</span>
                    <span className="shrink-0 text-xs text-slate-400">{titleMatch ? '제목 일치' : '내용 일치'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
