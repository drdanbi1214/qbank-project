import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import {
  fetchLectureDocument,
  fetchLectureDocuments,
  fetchLectureFacets,
  type LectureDocument,
} from '@/lib/queries/lectures'
import { cn } from '@/utils/cn'

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

/** 목록 한 줄. 제목 아래에 교수·연도·쪽수·용량을 한 줄로 붙인다. */
function LectureRow({ lecture, subjectName }: { lecture: LectureDocument; subjectName?: string }) {
  const meta = [
    lecture.professor,
    lecture.lectureYear ? `${lecture.lectureYear}년` : null,
    subjectName,
    lecture.pageCount ? `${lecture.pageCount}쪽` : null,
    sizeLabel(lecture.byteSize),
  ].filter(Boolean)

  return (
    <li>
      <Link
        to={`/lectures/${lecture.id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lecture.title}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {meta.join(' · ') || '정보 없음'}
          </span>
        </span>
        {!lecture.isPublished && (
          <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
            비공개
          </span>
        )}
      </Link>
    </li>
  )
}

export function LecturesPage() {
  const { lectureId } = useParams()
  const { taxonomy } = useData()

  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [professor, setProfessor] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')

  // 조회 결과에 조건을 함께 담아 둔다. 효과 안에서 곧바로 setState(null) 로
  // 비우면 React Compiler 가 막으므로, 지금 조건과 담긴 조건을 견줘 "아직 못
  // 받았음"을 판단한다. 인쇄 화면도 같은 방식을 쓴다.
  const [loaded, setLoaded] = useState<{ key: string; items: LectureDocument[] } | null>(null)
  const [facets, setFacets] = useState<{ professors: string[]; years: number[] }>({
    professors: [],
    years: [],
  })
  const [loadedDetail, setLoadedDetail] = useState<{ id: string; item: LectureDocument | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestKey = [subjectId ?? '', professor ?? '', year ?? '', debounced].join('|')

  // 본문까지 훑는 검색이라 글자마다 왕복하면 느리다.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword), 300)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    let active = true
    void fetchLectureDocuments({ subjectId, professor, year, keyword: debounced })
      .then((next) => active && setLoaded({ key: requestKey, items: next }))
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '강의록을 불러오지 못했습니다.')
        setLoaded({ key: requestKey, items: [] })
      })
    return () => {
      active = false
    }
  }, [subjectId, professor, year, debounced, requestKey])

  const rows = loaded?.key === requestKey ? loaded.items : null

  // 거르개 값은 과목이 바뀔 때만 다시 받는다. 교수 목록이 과목마다 다르다.
  useEffect(() => {
    let active = true
    void fetchLectureFacets(subjectId)
      .then((next) => active && setFacets(next))
      .catch(() => active && setFacets({ professors: [], years: [] }))
    return () => {
      active = false
    }
  }, [subjectId])

  useEffect(() => {
    if (!lectureId) return
    let active = true
    void fetchLectureDocument(lectureId)
      .then((next) => active && setLoadedDetail({ id: lectureId, item: next }))
      .catch(() => active && setLoadedDetail({ id: lectureId, item: null }))
    return () => {
      active = false
    }
  }, [lectureId])

  const detail = loadedDetail && loadedDetail.id === lectureId ? loadedDetail.item : null

  const subjectName = useMemo(() => {
    return (id: string) => taxonomy?.subjectById.get(id)?.name
  }, [taxonomy])

  if (lectureId) {
    if (!detail) {
      return (
        <div className="flex justify-center py-20">
          <Spinner className="h-7 w-7" />
        </div>
      )
    }

    const meta = [
      detail.professor,
      detail.lectureYear ? `${detail.lectureYear}년` : null,
      subjectName(detail.subjectId),
      detail.curriculum,
      detail.pageCount ? `${detail.pageCount}쪽` : null,
      sizeLabel(detail.byteSize),
    ].filter(Boolean)

    return (
      <section>
        <header className="mb-4">
          <Link
            to="/lectures"
            className="text-sm text-brand-700 hover:underline dark:text-brand-300"
          >
            ← 강의록 목록
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
          <LecturePdfViewer storagePath={detail.filePath} title={detail.title} />
        </Suspense>
      </section>
    )
  }

  const subjects = taxonomy?.subjects ?? []
  const hasFilter = subjectId || professor || year || keyword.trim()

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">강의록</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          교수·연도로 추리거나 제목과 본문으로 찾을 수 있습니다.
        </p>
      </header>

      <div className="mb-4 flex flex-col gap-2">
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="제목 또는 본문 검색"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={subjectId ?? ''}
            onChange={(event) => {
              setSubjectId(event.target.value || null)
              setProfessor(null)
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">전체 과목</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>

          <select
            value={professor ?? ''}
            onChange={(event) => setProfessor(event.target.value || null)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">전체 교수</option>
            {facets.professors.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            value={year ?? ''}
            onChange={(event) => setYear(event.target.value ? Number(event.target.value) : null)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">전체 연도</option>
            {facets.years.map((value) => (
              <option key={value} value={value}>
                {value}년
              </option>
            ))}
          </select>

          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setSubjectId(null)
                setProfessor(null)
                setYear(null)
                setKeyword('')
              }}
              className={cn(
                'rounded-lg px-2 py-1.5 text-sm text-slate-500 transition-colors',
                'hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
              )}
            >
              조건 지우기
            </button>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {hasFilter ? '조건에 맞는 강의록이 없습니다.' : '등록된 강의록이 없습니다.'}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{rows.length}건</p>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {rows.map((lecture) => (
              <LectureRow
                key={lecture.id}
                lecture={lecture}
                subjectName={subjectName(lecture.subjectId)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
