import { Suspense, lazy, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { LectureNotesPanel } from '@/components/lecture/LectureNotesPanel'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { PERMISSION } from '@/lib/permissions'
import {
  fetchLectureDocument,
  fetchLectureDocumentVariants,
  fetchLectureStudentNotes,
  type LectureDocument,
  type LectureDocumentVariant,
  type LectureStudentNote,
} from '@/lib/queries/lectures'

// pdfjs 는 무거워서 강의록을 실제로 열 때만 받아 온다. 목록만 보는 사람이
// 뷰어 몫까지 내려받을 이유가 없다.
const LecturePdfViewer = lazy(() =>
  import('@/components/lecture/LecturePdfViewer').then((module) => ({
    default: module.LecturePdfViewer,
  })),
)

const LECTURE_SPLIT_STORAGE_KEY = 'lecture-reader-pdf-width'
const LECTURE_SPLIT_SIDE_STORAGE_KEY = 'lecture-reader-pdf-side'
// 마지막으로 고른 대체본 종류를 강의록마다가 아니라 종류 단위로 기억한다.
// 'original' 이거나 lecture_document_variants.kind 값('annotated' 등)이 들어간다.
const LECTURE_VARIANT_KIND_STORAGE_KEY = 'lecture-reader-variant-kind'
const MIN_PDF_PANE_PERCENT = 30
const MAX_PDF_PANE_PERCENT = 70

type PdfPaneSide = 'left' | 'right'

function storedVariantKind(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(LECTURE_VARIANT_KIND_STORAGE_KEY)
    return value && value !== 'original' ? value : null
  } catch {
    return null
  }
}

function clampPanePercent(value: number): number {
  return Math.min(MAX_PDF_PANE_PERCENT, Math.max(MIN_PDF_PANE_PERCENT, value))
}

function initialPanePercent(): number {
  if (typeof window === 'undefined') return 50
  const stored = Number(window.localStorage.getItem(LECTURE_SPLIT_STORAGE_KEY))
  return Number.isFinite(stored) ? clampPanePercent(stored) : 50
}

function initialPdfPaneSide(): PdfPaneSide {
  if (typeof window === 'undefined') return 'left'
  return window.localStorage.getItem(LECTURE_SPLIT_SIDE_STORAGE_KEY) === 'right'
    ? 'right'
    : 'left'
}

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
  // 후배 필기본 등 대체본. RLS 가 권한을 검사하므로 권한이 없으면 빈 배열이다.
  const [variantsLoaded, setVariantsLoaded] = useState<{
    id: string
    items: LectureDocumentVariant[]
    error: string | null
  } | null>(null)
  // 사용자가 이 강의록에서 토글을 직접 누른 값. lectureId 를 함께 들고 있어,
  // 다른 강의록으로 옮기면 이 선택은 무시되고 저장된 선호로 되돌아간다.
  const [variantChoice, setVariantChoice] = useState<{
    lectureId: string
    variantId: string | null
  } | null>(null)
  const [mobileView, setMobileView] = useState<'pdf' | 'notes'>(() =>
    params.get('view') === 'notes' || initialNoteId ? 'notes' : 'pdf',
  )
  const splitContainer = useRef<HTMLDivElement>(null)
  const panePercentRef = useRef(50)
  const [pdfPanePercent, setPdfPanePercent] = useState(initialPanePercent)
  const [pdfPaneSide, setPdfPaneSide] = useState<PdfPaneSide>(initialPdfPaneSide)
  const [isResizing, setIsResizing] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  const updatePanePercent = (value: number, persist = false) => {
    const next = clampPanePercent(value)
    panePercentRef.current = next
    setPdfPanePercent(next)
    if (persist) window.localStorage.setItem(LECTURE_SPLIT_STORAGE_KEY, String(next))
  }

  useEffect(() => {
    panePercentRef.current = pdfPanePercent
  }, [pdfPanePercent])

  useEffect(() => {
    if (!isResizing) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const resize = (event: PointerEvent) => {
      const bounds = splitContainer.current?.getBoundingClientRect()
      if (!bounds || bounds.width <= 0) return
      const pointerFromLeft = ((event.clientX - bounds.left) / bounds.width) * 100
      updatePanePercent(pdfPaneSide === 'left' ? pointerFromLeft : 100 - pointerFromLeft)
    }
    const finish = () => {
      window.localStorage.setItem(LECTURE_SPLIT_STORAGE_KEY, String(panePercentRef.current))
      setIsResizing(false)
    }

    window.addEventListener('pointermove', resize)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('blur', finish, { once: true })
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', resize)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('blur', finish)
    }
  }, [isResizing, pdfPaneSide])

  useEffect(() => {
    if (!fullscreen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [fullscreen])

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
    if (!lectureId) return
    let active = true
    void fetchLectureDocumentVariants(lectureId)
      .then((items) => active && setVariantsLoaded({ id: lectureId, items, error: null }))
      .catch((caught: unknown) => {
        console.error('강의록 대체본 목록을 불러오지 못했습니다.', caught)
        if (active) {
          setVariantsLoaded({
            id: lectureId,
            items: [],
            error: '필기본 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.',
          })
        }
      })
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

  const variants = useMemo<LectureDocumentVariant[]>(
    () => (variantsLoaded !== null && variantsLoaded.id === lectureId ? variantsLoaded.items : []),
    [variantsLoaded, lectureId],
  )
  const variantsError =
    variantsLoaded !== null && variantsLoaded.id === lectureId ? variantsLoaded.error : null

  // 어떤 파일을 그릴지: 이 강의록에서 직접 누른 값이 있으면 그것, 없으면 지난번에
  // 고른 종류(localStorage)와 같은 대체본, 그마저 없으면 원본(null).
  const activeVariant = useMemo(() => {
    if (variants.length === 0) return null
    if (variantChoice && variantChoice.lectureId === lectureId) {
      return variants.find((item) => item.id === variantChoice.variantId) ?? null
    }
    // 풀이·검색 결과의 ?page= 링크는 원본 강의록의 쪽 번호다. 저장된 필기본
    // 선호보다 딥링크를 우선하되, 화면이 열린 뒤 사용자가 직접 필기본을 고르는
    // 것은 허용한다.
    if (initialPage !== null) return null
    const prefKind = storedVariantKind()
    return prefKind ? (variants.find((item) => item.kind === prefKind) ?? null) : null
  }, [variants, variantChoice, lectureId, initialPage])

  const selectVariant = (variant: LectureDocumentVariant | null) => {
    setVariantChoice({ lectureId: lectureId ?? '', variantId: variant?.id ?? null })
    try {
      window.localStorage.setItem(
        LECTURE_VARIANT_KIND_STORAGE_KEY,
        variant?.kind ?? 'original',
      )
    } catch {
      // 저장이 막힌 브라우저에서도 이번 선택은 그대로 쓴다.
    }
  }

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

  const togglePaneSide = () => {
    const next: PdfPaneSide = pdfPaneSide === 'left' ? 'right' : 'left'
    setPdfPaneSide(next)
    window.localStorage.setItem(LECTURE_SPLIT_SIDE_STORAGE_KEY, next)
  }

  const pdfPane = (
    <div
      key="pdf-pane"
      className={`${showNotesPanel && effectiveMobileView !== 'pdf' ? 'hidden' : 'block'} h-full min-w-0 w-full overflow-y-auto overscroll-contain lg:block ${
        showNotesPanel
          ? `lg:w-[var(--lecture-pdf-width)] lg:flex-none ${
              pdfPaneSide === 'left' ? 'lg:pr-1' : 'lg:pl-1'
            }`
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
          // 대체본으로 바꾸면 다른 PDF 를 처음부터 받아야 하므로 통째로 다시 만든다.
          key={`${detail.id}:${activeVariant?.id ?? 'original'}`}
          storagePath={activeVariant?.filePath ?? detail.filePath}
          title={activeVariant ? `${detail.title} (${activeVariant.label})` : detail.title}
          // 개인 필기는 원본/각 필기본 id로 분리한다. 풀이용 쪽 복사는 쪽 번호가
          // 원본과 어긋날 수 있는 필기본에서만 계속 숨긴다.
          lectureId={detail.id}
          annotationVariantId={activeVariant?.id ?? null}
          allowPageCopy={!activeVariant}
          professor={detail.professor}
          initialPage={activeVariant ? null : initialPage}
          initialQuery={initialQuery}
          paneMode={showNotesPanel}
          containedScroll
        />
      </Suspense>
    </div>
  )

  const splitDivider = showNotesPanel ? (
    <div
      key="split-divider"
      role="separator"
      aria-label="PDF와 요약정리본 너비 조절"
      aria-orientation="vertical"
      aria-valuemin={MIN_PDF_PANE_PERCENT}
      aria-valuemax={MAX_PDF_PANE_PERCENT}
      aria-valuenow={Math.round(pdfPanePercent)}
      tabIndex={0}
      title="드래그하여 너비 조절 · 더블클릭하여 50:50"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        setIsResizing(true)
      }}
      onDoubleClick={() => updatePanePercent(50, true)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          updatePanePercent(pdfPanePercent + (pdfPaneSide === 'left' ? -2 : 2), true)
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          updatePanePercent(pdfPanePercent + (pdfPaneSide === 'left' ? 2 : -2), true)
        } else if (event.key === 'Home') {
          event.preventDefault()
          updatePanePercent(50, true)
        }
      }}
      className={`group hidden w-4 flex-none cursor-col-resize touch-none items-stretch justify-center outline-none lg:flex ${
        isResizing ? 'bg-brand-50/70 dark:bg-brand-950/30' : ''
      }`}
    >
      <span className="my-2 w-1 rounded-full bg-slate-200 transition-colors group-hover:bg-brand-400 group-focus:bg-brand-400 dark:bg-slate-700 dark:group-hover:bg-brand-500 dark:group-focus:bg-brand-500" />
    </div>
  ) : null

  const notesPane = showNotesPanel ? (
    <aside
      key="notes-pane"
      aria-label="학생 정리본"
      className={`${effectiveMobileView !== 'notes' ? 'hidden' : 'block'} h-full min-w-0 w-full overflow-y-auto overscroll-contain lg:block lg:flex-1 ${
        pdfPaneSide === 'left' ? 'lg:pl-1' : 'lg:pr-1'
      }`}
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
  ) : null

  const splitPanes =
    !showNotesPanel || pdfPaneSide === 'left'
      ? [pdfPane, splitDivider, notesPane]
      : [notesPane, splitDivider, pdfPane]

  return (
    <section className="flex h-full min-h-0 flex-col">
      <header className="mb-4 shrink-0">
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
              정리본 {notes.length}개
            </span>
          )}
          {showNotesPanel && (
            <span className="ml-auto hidden items-center gap-1.5 lg:inline-flex">
              <button
                type="button"
                onClick={togglePaneSide}
                aria-label={`강의록을 ${pdfPaneSide === 'left' ? '오른쪽' : '왼쪽'}으로 이동`}
                title={`현재 강의록이 ${pdfPaneSide === 'left' ? '왼쪽' : '오른쪽'}에 있습니다`}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-200"
              >
                ↔ 좌우 바꾸기
              </button>
              <button
                type="button"
                onClick={() => setFullscreen(true)}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-brand-500 dark:hover:text-brand-200"
              >
                ⛶ 전체화면
              </button>
            </span>
          )}
        </div>

        {/* 후배 필기본 등 대체본이 있을 때만. 권한 없는 사람에겐 목록이 비어 안 뜬다. */}
        {variants.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              파일 선택
            </span>
            <div
              role="group"
              aria-label="강의록 파일 선택"
              className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
            >
              <button
                type="button"
                onClick={() => selectVariant(null)}
                aria-pressed={activeVariant === null}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  activeVariant === null
                    ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                오리지널 파일
              </button>
              {variants.map((variant) => (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => selectVariant(variant)}
                  aria-pressed={activeVariant?.id === variant.id}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    activeVariant?.id === variant.id
                      ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-200'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {variant.label}
                </button>
              ))}
            </div>
            {activeVariant && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500">
                후배가 필기한 PDF입니다 · 개인 필기·복사 꺼짐
              </span>
            )}
          </div>
        )}
        {variantsError && (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-300" role="alert">
            {variantsError}
          </p>
        )}
      </header>

      {showNotesPanel && (
        <div
          role="tablist"
          aria-label="강의록 보기"
          className="z-20 mb-3 grid shrink-0 grid-cols-2 rounded-lg bg-slate-100 p-1 shadow-sm dark:bg-slate-800 lg:hidden"
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
            정리본
          </button>
        </div>
      )}

      <div
        ref={splitContainer}
        className={
          fullscreen
            ? 'fixed inset-0 z-40 flex min-h-0 min-w-0 items-stretch overflow-hidden bg-slate-50 dark:bg-slate-950'
            : 'flex min-h-0 min-w-0 flex-1 items-stretch overflow-hidden'
        }
        style={
          showNotesPanel
            ? ({ '--lecture-pdf-width': `${pdfPanePercent}%` } as CSSProperties)
            : undefined
        }
      >
        {fullscreen && (
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            title="Esc"
            className="fixed right-3 top-3 z-50 rounded-lg border border-slate-300 bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-lg backdrop-blur hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            ✕ 전체화면 종료
          </button>
        )}
        {splitPanes}
      </div>
    </section>
  )
}
