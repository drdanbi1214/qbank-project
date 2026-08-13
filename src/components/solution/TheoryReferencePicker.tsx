import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Button } from '@/components/ui/Button'
import { uploadLectureFile } from '@/lib/uploads'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import type { SolutionReference } from '@/lib/queries/solutions'

type Props = { subjectId: string | null; value: SolutionReference[]; onChange: (next: SolutionReference[]) => void; userId: string }
type Result = { document: TheoryDocument; path: string; titleMatch: boolean }

function pathOf(document: TheoryDocument, documents: TheoryDocument[]): string {
  const names = [document.title]
  let parent = document.parentId ? documents.find((item) => item.id === document.parentId) : null
  while (parent) {
    names.unshift(parent.title)
    parent = parent.parentId ? documents.find((item) => item.id === parent!.parentId) : null
  }
  return names.join(' > ')
}

export function TheoryReferencePicker({ subjectId, value, onChange, userId }: Props) {
  const [allenOpen, setAllenOpen] = useState(false)
  const [lectureOpen, setLectureOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [documents, setDocuments] = useState<TheoryDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<TheoryDocument | null>(null)
  const [lectureName, setLectureName] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!allenOpen || !subjectId || documents.length > 0) return
    setLoading(true)
    void fetchTheoryDocuments(subjectId).then(setDocuments).finally(() => setLoading(false))
  }, [allenOpen, subjectId, documents.length])

  const results = useMemo<Result[]>(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return []
    return documents.filter((item) => item.hasContent).map((document) => {
      const titleMatch = document.title.toLowerCase().includes(keyword)
      return { document, path: pathOf(document, documents), titleMatch, bodyMatch: JSON.stringify(document.content).toLowerCase().includes(keyword) }
    }).filter((item) => item.titleMatch || item.bodyMatch)
      .sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || a.path.localeCompare(b.path, 'ko', { numeric: true })).slice(0, 20)
  }, [documents, query])

  if (!subjectId) return null
  const remove = (reference: SolutionReference) => onChange(value.filter((item) => item.url !== reference.url))
  const addAllen = (document: TheoryDocument) => {
    const url = `/theory/${subjectId}/${document.id}`
    if (!value.some((item) => item.url === url)) onChange([...value, { label: pathOf(document, documents), url, kind: 'theory' }])
    setQuery('')
  }
  async function attachLecture(file: File) {
    setUploading(true)
    try {
      const url = await uploadLectureFile(file, userId)
      onChange([...value, { label: lectureName.trim() || file.name, url, kind: 'lecture' }])
      setLectureName(''); setLectureOpen(false)
    } finally { setUploading(false) }
  }

  return <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">관련 단원 선택</span>
      <Button size="sm" variant="secondary" onClick={() => setAllenOpen((open) => !open)}>알렌</Button>
      <Button size="sm" variant="secondary" onClick={() => setLectureOpen((open) => !open)}>강의록</Button>
      <span className="text-xs text-slate-400">선택하지 않아도 저장할 수 있습니다.</span>
    </div>
    {value.length > 0 && <ul className="mt-2 space-y-1.5">
      {value.map((reference) => <li key={reference.url} className="flex items-center gap-2 rounded-lg bg-brand-50 px-2 py-1.5 text-sm text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">
        <span className="shrink-0 text-xs font-semibold">{reference.kind === 'lecture' ? '강의록' : '알렌'}</span>
        {reference.kind === 'theory' ? <Link to={reference.url ?? '#'} target="_blank" className="min-w-0 flex-1 truncate hover:underline">{reference.label}</Link> : <span className="min-w-0 flex-1 truncate">{reference.label}</span>}
        <button type="button" aria-label={`${reference.label} 삭제`} onClick={() => remove(reference)}>×</button>
      </li>)}</ul>}
    {allenOpen && <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이론 제목 또는 내용 검색" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
      {loading ? <p className="mt-2 text-xs text-slate-400">이론을 불러오는 중…</p> : query.trim() && <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
        {results.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">검색 결과가 없습니다.</li> : results.map(({ document, path, titleMatch }) => <li key={document.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-slate-800">
          <button type="button" onClick={() => addAllen(document)} className="min-w-0 flex-1 text-left text-sm hover:text-brand-700 dark:hover:text-brand-200"><span className="block truncate">{path}</span><span className="text-xs text-slate-400">{titleMatch ? '제목 일치' : '내용 일치'}</span></button>
          <Button size="sm" variant="ghost" onClick={() => setPreview(document)}>이론 보기</Button>
        </li>)}</ul>}
    </div>}
    {lectureOpen && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
      <input value={lectureName} onChange={(event) => setLectureName(event.target.value)} placeholder="강의록 이름" className="w-40 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
      <input ref={fileRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void attachLecture(file); event.currentTarget.value = '' }} />
      <Button size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? '첨부 중…' : '+ 파일 첨부'}</Button>
    </div>}
    {preview && <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setPreview(null)}><article className="max-h-[85dvh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center gap-3"><h2 className="flex-1 text-lg font-bold">{pathOf(preview, documents)}</h2><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>닫기</Button></div><RichTextViewer doc={preview.content} /></article></div>}
  </div>
}
