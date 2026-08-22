import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { fetchLectureDocument, type LectureDocument } from '@/lib/queries/lectures'

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

  // 풀이의 강의록 참조가 `?page=` 로 특정 쪽을 가리킨다.
  const rawPage = Number(params.get('page'))
  const initialPage = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : null
  const initialQuery = params.get('q')?.trim() ?? ''

  const [loaded, setLoaded] = useState<{ id: string; item: LectureDocument | null } | null>(null)

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

  const ready = loaded !== null && loaded.id === lectureId
  const detail = ready ? loaded.item : null

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
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{meta.join(' · ')}</p>
      </header>

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
        />
      </Suspense>
    </section>
  )
}
