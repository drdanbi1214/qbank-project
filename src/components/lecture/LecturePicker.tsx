import { useCallback, useEffect, useMemo, useState } from 'react'
import { LecturePdfViewer } from '@/components/lecture/LecturePdfViewer'
import { renderLecturePageToBlob } from '@/components/lecture/renderLecturePage'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { fetchLectureDocuments, splitLectureHits, type LectureDocument } from '@/lib/queries/lectures'
import { uploadImage } from '@/lib/uploads'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/** 본문에 박을 한 쪽. 이미지 경로와 함께 원본으로 가는 길을 들고 있다. */
export type LecturePagePick = {
  src: string
  lectureId: string
  page: number
  title: string
  professor: string | null
}

type Props = {
  userId: string
  onPick: (picks: LecturePagePick[]) => void
  onCancel: () => void
}

/**
 * 강의록에서 원하는 쪽을 골라 글에 넣는다.
 *
 * 두 단계다. 먼저 제목·교수·본문으로 강의록을 찾고, 고른 강의록을 쭉 넘겨보며
 * 쪽마다 체크한다. 검색해서 들어오면 일치한 쪽으로 바로 옮겨 준다.
 *
 * 넣는 것은 PDF 참조가 아니라 그 쪽을 구운 이미지다. 참조만 담으면 글을 읽는
 * 사람이 60MB 짜리 PDF 를 통째로 받아야 하고, 한 글에 여러 강의록을 인용하면
 * 그만큼 배가 된다. 대신 강의록 id 와 쪽 번호를 함께 담아 원본으로 갈 수 있게 한다.
 */
export function LecturePicker({ userId, onPick, onCancel }: Props) {
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')
  const [results, setResults] = useState<LectureDocument[] | null>(null)
  const [chosen, setChosen] = useState<LectureDocument | null>(null)
  const [pages, setPages] = useState<number[]>([])
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword), 300)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    if (chosen) return
    let active = true
    void fetchLectureDocuments({ keyword: debounced })
      .then((rows) => active && setResults(rows))
      .catch(() => active && setResults([]))
    return () => {
      active = false
    }
  }, [debounced, chosen])

  const togglePage = useCallback((pageNumber: number) => {
    setPages((prev) =>
      prev.includes(pageNumber)
        ? prev.filter((value) => value !== pageNumber)
        : [...prev, pageNumber],
    )
  }, [])

  // 고른 순서가 아니라 쪽 번호 순으로 넣는다. 읽는 사람에겐 그게 자연스럽다.
  const ordered = useMemo(() => [...pages].sort((a, b) => a - b), [pages])

  const hits = useMemo(
    () => splitLectureHits(results ?? [], debounced),
    [results, debounced],
  )

  async function insert() {
    if (!chosen || !document || ordered.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const picks: LecturePagePick[] = []
      for (const page of ordered) {
        const blob = await renderLecturePageToBlob(document, page)
        const file = new File([blob], `${chosen.title}-${page}.jpg`, { type: 'image/jpeg' })
        picks.push({
          src: await uploadImage(file, userId),
          lectureId: chosen.id,
          page,
          title: chosen.title,
          professor: chosen.professor,
        })
      }
      onPick(picks)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '쪽을 넣지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[88dvh] w-full max-w-4xl flex-col rounded-xl bg-white dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
          {chosen && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setChosen(null)
                setPages([])
                setDocument(null)
              }}
            >
              ← 목록
            </Button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-lg font-bold">
            {chosen ? chosen.title : '강의록에서 가져오기'}
          </h2>
          {chosen && ordered.length > 0 && (
            <span className="shrink-0 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-900/50 dark:text-brand-200">
              {ordered.length}쪽 선택됨
            </span>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            닫기
          </Button>
        </header>

        {error && (
          <p className="mx-4 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!chosen ? (
            <>
              <input
                autoFocus
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="강의록 제목 · 교수 · 내용으로 검색"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
              />

              {results === null ? (
                <div className="flex justify-center py-12">
                  <Spinner className="h-6 w-6" />
                </div>
              ) : hits.byTitle.length + hits.byText.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                  {debounced.trim() ? '검색 결과가 없습니다.' : '등록된 강의록이 없습니다.'}
                </p>
              ) : (
                <>
                  {/* 제목 일치를 앞에서부터 서른 개 자르면 흔한 낱말일수록 본문
                      일치가 한 건도 남지 않는다. 무리를 갈라 따로 보여 준다. */}
                  <HitList
                    label={debounced.trim() ? '제목 · 교수' : null}
                    rows={hits.byTitle.slice(0, debounced.trim() ? 20 : 30)}
                    total={hits.byTitle.length}
                    onPick={setChosen}
                  />
                  <HitList
                    label="본문"
                    rows={hits.byText.slice(0, 30)}
                    total={hits.byText.length}
                    onPick={setChosen}
                  />
                </>
              )}
            </>
          ) : (
            <LecturePdfViewer
              storagePath={chosen.filePath}
              title={chosen.title}
              initialPage={chosen.matchPage}
              initialQuery={debounced.trim()}
              selectable
              selectedPages={pages}
              onTogglePage={togglePage}
              onDocumentReady={setDocument}
            />
          )}
        </div>

        {chosen && (
          <footer className="flex items-center gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">
              {ordered.length > 0 ? `${ordered.join(', ')}쪽` : '넣을 쪽을 체크하세요.'}
            </span>
            <Button variant="secondary" onClick={onCancel} disabled={busy}>
              취소
            </Button>
            <Button onClick={() => void insert()} disabled={busy || ordered.length === 0}>
              {busy ? '넣는 중…' : `${ordered.length || ''}쪽 삽입`}
            </Button>
          </footer>
        )}
      </div>
    </div>
  )
}

/** 검색 결과 한 무리. 무리 이름과 함께 몇 개 중 몇 개인지 밝힌다. */
function HitList({
  label,
  rows,
  total,
  onPick,
}: {
  label: string | null
  rows: LectureDocument[]
  total: number
  onPick: (lecture: LectureDocument) => void
}) {
  if (rows.length === 0) return null

  return (
    <section className="mt-3">
      {/* 검색 전 목록에도 전체가 몇 개인지는 알려 준다. 다 보여 주지 않기 때문이다. */}
      {(label || total > rows.length) && (
        <h3 className="mb-1 px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
          {label ? `${label} 일치 ${total}개` : `전체 ${total}개`}
          {total > rows.length && ` · 앞 ${rows.length}개`}
        </h3>
      )}
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {rows.map((lecture) => (
          <li key={lecture.id}>
            <button
              type="button"
              onClick={() => onPick(lecture)}
              className="w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="block truncate text-sm font-medium">{lecture.title}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                {[
                  lecture.professor,
                  lecture.lectureYear ? `${lecture.lectureYear}년` : null,
                  lecture.pageCount ? `${lecture.pageCount}쪽` : null,
                  // 본문이 걸린 검색이면 어디서 걸렸는지, 몇 쪽에 걸쳐 있는지 알려 준다.
                  lecture.matchPage
                    ? `${lecture.matchPage}쪽에 일치${
                        lecture.matchPageCount > 1 ? ` (${lecture.matchPageCount}쪽)` : ''
                      }`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {lecture.matchSnippet && (
                <span className="mt-1 block truncate text-xs text-slate-400">
                  “{lecture.matchSnippet}”
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
