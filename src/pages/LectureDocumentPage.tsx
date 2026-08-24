import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { LectureNotesPanel } from '@/components/lecture/LectureNotesPanel'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { PERMISSION } from '@/lib/permissions'
import {
  fetchLectureDocument,
  fetchLectureStudentNotes,
  type LectureDocument,
  type LectureStudentNote,
} from '@/lib/queries/lectures'

// pdfjs 는 무거워서 강의록을 실제로 열 때만 받아 온다. 목록만 보는 사람이
// 뷰어 몫까지 내려받을 이유가 없다.
const LecturePdfViewer = lazy(() =>
  import('@/components/lecture/LecturePdfViewer').then((module) => ({
    default: module.LecturePdfViewer,
  })),
)

function sizeLabel(bytes: number | null): string | null {
  if (!bytes) return null
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/** 강의록 한 건을 PDF 그대로 보여 준다. */
export function LectureDocumentPage() {
  const { lectureId } = useParams()
  const [params] = useSearchParams()
  const { hasPermission, isAdmin } = useAuth()
  const canViewStudentNotes =
    isAdmin || hasPermission(PERMISSION.mediprepLectureNotesView)

  // 풀이의 강의록 참조가 `?page=` 로 특정 쪽을 가리킨다.
  const rawPage = Number(params.get('page'))
  const initialPage = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : null
  const initialQuery = params.get('q')?.trim() ?? ''
  const initialNoteId = params.get('note')?.trim() || null
  const initialNoteQuery = params.get('nq')?.trim() ?? ''

  const [loaded, setLoaded] = useState<{ id: string; item: LectureDocument | null } | null>(null)
  const [notesLoaded, setNotesLoaded] = useState<{
    id: string
    items: LectureStudentNote[]
    error: string | null
  } | null>(null)
  const [mobileView, setMobileView] = useState<'pdf' | 'notes'>(() =>
    params.get('view') === 'notes' || initialNoteId ? 'notes' : 'pdf',
  )

  useEffect(() => {
    if (!lectureId) return
    let active = true
    void fetchLectureDocument(lectureId)
      .then((next) => active && setLoaded({ id: lectureId, item: next }))
      .catch(() => active && setLoaded({ id: lectureId, item: null }))
    return () => {
      active = false
    }
  }, [lectureId])

  useEffect(() => {
    if (!lectureId || !canViewStudentNotes) return
    let active = true
    void fetchLectureStudentNotes(lectureId)
      .then((items) => active && setNotesLoaded({ id: lectureId, items, error: null }))
      .catch((caught: unknown) => {
        if (!active) return
        setNotesLoaded({
          id: lectureId,
          items: [],
          error:
            caught instanceof Error ? caught.message : '강의 정리본을 불러오지 못했습니다.',
        })
      })
    return () => {
      active = false
    }
  }, [canViewStudentNotes, lectureId])

  const ready = loaded !== null && loaded.id === lectureId
  const detail = ready ? loaded.item : null
  const notesReady = notesLoaded !== null && notesLoaded.id === lectureId
  const notes = notesReady ? notesLoaded.items : []
  const notesError = notesReady ? notesLoaded.error : null
  // 로딩 중에는 오른쪽 자리를 먼저 잡아 레이아웃이 뒤늦게 흔들리지 않게 한다.
  // 로딩이 끝나고 정리본이 하나도 없으면 기존 PDF 단독 화면을 유지한다.
  const showNotesPanel =
    canViewStudentNotes && (!notesReady || notes.length > 0 || notesError !== null)
  const effectiveMobileView = showNotesPanel ? mobileView : 'pdf'

  if (!ready) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  if (!detail) {
    return (
      <section>
        <Link to="/lectures" className="text-sm text-brand-700 hover:underline dark:text-brand-300">
          ← 강의록
        </Link>
        <div className="mt-3 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            이 강의록은 지금 볼 수 없습니다. 지워졌거나 열람 권한이 없습니다.
          </p>
        </div>
      </section>
    )
  }

  const meta = [
    detail.professor,
    detail.lectureYear ? `${detail.lectureYear}년` : null,
    detail.curriculum,
    detail.pageCount ? `${detail.pageCount}쪽` : null,
    sizeLabel(detail.byteSize),
  ].filter(Boolean)

  return (
    <section>
      <header className="mb-4">
        <Link
          to={`/lectures/c/${detail.categoryId}`}
          className="text-sm text-brand-700 hover:underline dark:text-brand-300"
        >
          ← 목록으로
        </Link>
        <h1 className="mt-1 text-xl font-bold">{detail.title}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">{meta.join(' · ')}</p>
          {notes.length > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200">
              2026 정리본 {notes.length}개
            </span>
          )}
        </div>
      </header>

      {showNotesPanel && (
        <div
          role="tablist"
          aria-label="강의록 보기"
          className="sticky top-14 z-20 mb-3 grid grid-cols-2 rounded-lg bg-slate-100 p-1 shadow-sm dark:bg-slate-800 lg:hidden"
        >
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMobileView === 'pdf'}
            onClick={() => setMobileView('pdf')}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              effectiveMobileView === 'pdf'
                ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            PDF 강의록
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveMobileView === 'notes'}
            onClick={() => setMobileView('notes')}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              effectiveMobileView === 'notes'
                ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-700 dark:text-emerald-200'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            2026 정리본
          </button>
        </div>
      )}

      <div className={showNotesPanel ? 'grid min-w-0 gap-4 lg:grid-cols-2' : ''}>
        <div
          className={`${showNotesPanel && effectiveMobileView !== 'pdf' ? 'hidden' : 'block'} min-w-0 lg:block ${
            showNotesPanel
              ? 'lg:h-[calc(100dvh-10.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1'
              : ''
          }`}
        >
          <Suspense
            fallback={
              <div className="flex justify-center py-16">
                <Spinner className="h-7 w-7" />
              </div>
            }
          >
            <LecturePdfViewer
              storagePath={detail.filePath}
              title={detail.title}
              initialPage={initialPage}
              initialQuery={initialQuery}
              paneMode={showNotesPanel}
            />
          </Suspense>
        </div>

        {showNotesPanel && (
          <aside
            aria-label="2026 학생 정리본"
            className={`${effectiveMobileView !== 'notes' ? 'hidden' : 'block'} min-w-0 lg:block lg:h-[calc(100dvh-10.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pl-1`}
          >
            {!notesReady ? (
              <div className="flex flex-col items-center gap-2 py-16">
                <Spinner className="h-7 w-7" />
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  강의 정리본을 불러오는 중…
                </p>
              </div>
            ) : notesError ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {notesError}
              </p>
            ) : (
              <LectureNotesPanel
                key={`${lectureId ?? ''}|${initialNoteId ?? ''}|${initialNoteQuery}`}
                notes={notes}
                initialQuery={initialNoteQuery}
                activeNoteId={initialNoteId}
              />
            )}
          </aside>
        )}
      </div>
    </section>
  )
}
