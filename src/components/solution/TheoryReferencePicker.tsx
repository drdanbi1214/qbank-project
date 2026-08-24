import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fetchLectureDocuments, mixLectureHits, type LectureDocument } from '@/lib/queries/lectures'
import { fetchTheoryDocuments, type TheoryDocument } from '@/lib/queries/theory'
import type { SolutionReference } from '@/lib/queries/solutions'

type Props = { subjectId: string | null; value: SolutionReference[]; onChange: (next: SolutionReference[]) => void }
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

export function TheoryReferencePicker({ subjectId, value, onChange }: Props) {
  const [allenOpen, setAllenOpen] = useState(false)
  const [lectureOpen, setLectureOpen] = useState(false)
  const [query, setQuery] = useState('')
  // null = 아직 안 불러옴. 별도의 loading 상태를 두면 효과 안에서 곧바로
  // setState 를 부르게 되어 React Compiler 가 막는다.
  const [loaded, setLoaded] = useState<TheoryDocument[] | null>(null)
  const [preview, setPreview] = useState<TheoryDocument | null>(null)
  const [lectureQuery, setLectureQuery] = useState('')
  const [lectureLoaded, setLectureLoaded] = useState<{
    key: string
    rows: LectureDocument[]
  } | null>(null)
  const [lecturePage, setLecturePage] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!allenOpen || !subjectId || loaded !== null) return
    void fetchTheoryDocuments(subjectId)
      .then(setLoaded)
      .catch(() => setLoaded([]))
  }, [allenOpen, subjectId, loaded])

  useEffect(() => {
    if (!lectureOpen) return
    const keyword = lectureQuery.trim()
    let active = true
    const timer = setTimeout(() => {
      // 강의록 분류는 임상 과목과 다른 축이라 과목으로 좁히지 않는다.
      // 제목·교수·본문 검색만으로 찾는다.
      void fetchLectureDocuments({ keyword })
        .then((next) =>
          active && setLectureLoaded({ key: keyword, rows: mixLectureHits(next, keyword, 20) }),
        )
        .catch(() => active && setLectureLoaded({ key: keyword, rows: [] }))
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [lectureOpen, lectureQuery])

  const documents = useMemo(() => loaded ?? [], [loaded])
  const loading = allenOpen && loaded === null
  const lectureKeyword = lectureQuery.trim()
  const lectures = lectureLoaded?.key === lectureKeyword ? lectureLoaded.rows : null

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
  // 강의록은 더 이상 풀이마다 파일을 올리지 않는다. 관리자가 등록해 둔 문서를
  // 가리키기만 해서, 같은 강의록이 사람 수만큼 복사되지 않게 한다.
  const addLecture = (lecture: LectureDocument) => {
    const raw = Number(lecturePage[lecture.id])
    const page = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null
    const url = `/lectures/${lecture.id}`
    if (!value.some((item) => item.url === url)) {
      const label = [lecture.title, lecture.professor].filter(Boolean).join(' · ')
      onChange([...value, { label, url, kind: 'lecture', page }])
    }
    setLectureQuery('')
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
    {lectureOpen && <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <input autoFocus value={lectureQuery} onChange={(event) => setLectureQuery(event.target.value)} placeholder="강의록 제목·교수·본문 검색" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
      {lectures === null ? <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Spinner className="h-4 w-4" />강의록 검색 중…</p> : lectures.length === 0 ? <p className="mt-2 text-xs text-slate-400">{lectureQuery.trim() ? '검색 결과가 없습니다.' : '등록된 강의록이 없습니다.'}</p> : <ul className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
        {lectures.map((lecture) => <li key={lecture.id} className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-0 dark:border-slate-800">
          <button type="button" onClick={() => addLecture(lecture)} className="min-w-0 flex-1 text-left text-sm hover:text-brand-700 dark:hover:text-brand-200">
            <span className="block truncate">{lecture.title}</span>
            <span className="text-xs text-slate-400">{[lecture.professor, lecture.lectureYear ? `${lecture.lectureYear}년` : null, lecture.pageCount ? `${lecture.pageCount}쪽` : null, lecture.matchPage ? `${lecture.matchPage}쪽 본문 일치` : null].filter(Boolean).join(' · ') || '정보 없음'}</span>
            {lecture.matchSnippet && <span className="block truncate text-xs text-slate-400">“{lecture.matchSnippet}”</span>}
          </button>
          {/* 강의록은 길어서 몇 쪽인지 함께 남겨 두면 다시 찾기 쉽다. */}
          <input value={lecturePage[lecture.id] ?? ''} onChange={(event) => setLecturePage((prev) => ({ ...prev, [lecture.id]: event.target.value }))} inputMode="numeric" placeholder="쪽" aria-label={`${lecture.title} 쪽 번호`} className="w-14 shrink-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950" />
        </li>)}
      </ul>}
    </div>}
    {preview && <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={() => setPreview(null)}><article className="max-h-[85dvh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex items-center gap-3"><h2 className="flex-1 text-lg font-bold">{pathOf(preview, documents)}</h2><Button size="sm" variant="ghost" onClick={() => setPreview(null)}>닫기</Button></div><RichTextViewer doc={preview.content} /></article></div>}
  </div>
}
