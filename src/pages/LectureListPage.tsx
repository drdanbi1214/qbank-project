import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchLectureCategories,
  fetchLectureDocuments,
  fetchLectureFacets,
  type LectureDocument,
} from '@/lib/queries/lectures'

function sizeLabel(bytes: number | null): string | null {
  if (!bytes) return null
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`
}

/** 한 분류 안의 강의록 목록. 교수·연도로 추리고 제목·본문으로 찾는다. */
export function LectureListPage() {
  const { categoryId } = useParams()

  const [professor, setProfessor] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [keyword, setKeyword] = useState('')
  const [debounced, setDebounced] = useState('')

  const [categoryName, setCategoryName] = useState('')
  const [loaded, setLoaded] = useState<{ key: string; items: LectureDocument[] } | null>(null)
  const [facets, setFacets] = useState<{ professors: string[]; years: number[] }>({
    professors: [],
    years: [],
  })
  const [error, setError] = useState<string | null>(null)

  const requestKey = [categoryId ?? '', professor ?? '', year ?? '', debounced].join('|')

  // 본문까지 훑는 검색이라 글자마다 왕복하면 느리다.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(keyword), 300)
    return () => clearTimeout(timer)
  }, [keyword])

  useEffect(() => {
    let active = true
    void fetchLectureCategories()
      .then((rows) => {
        if (active) setCategoryName(rows.find((row) => row.id === categoryId)?.name ?? '강의록')
      })
      .catch(() => active && setCategoryName('강의록'))
    return () => {
      active = false
    }
  }, [categoryId])

  useEffect(() => {
    let active = true
    void fetchLectureDocuments({ categoryId, professor, year, keyword: debounced })
      .then((next) => active && setLoaded({ key: requestKey, items: next }))
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '강의록을 불러오지 못했습니다.')
        setLoaded({ key: requestKey, items: [] })
      })
    return () => {
      active = false
    }
  }, [categoryId, professor, year, debounced, requestKey])

  useEffect(() => {
    let active = true
    void fetchLectureFacets(categoryId)
      .then((next) => active && setFacets(next))
      .catch(() => active && setFacets({ professors: [], years: [] }))
    return () => {
      active = false
    }
  }, [categoryId])

  const rows = loaded?.key === requestKey ? loaded.items : null
  const hasFilter = Boolean(professor || year || keyword.trim())

  return (
    <section>
      <header className="mb-4">
        <Link to="/lectures" className="text-sm text-brand-700 hover:underline dark:text-brand-300">
          ← 분류 목록
        </Link>
        <h1 className="mt-1 text-xl font-bold">{categoryName}</h1>
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
                setProfessor(null)
                setYear(null)
                setKeyword('')
              }}
              className="rounded-lg px-2 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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
            {hasFilter ? '조건에 맞는 강의록이 없습니다.' : '이 분류에는 아직 강의록이 없습니다.'}
          </p>
        </div>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{rows.length}건</p>
          <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {rows.map((lecture) => {
              const meta = [
                lecture.professor,
                lecture.lectureYear ? `${lecture.lectureYear}년` : null,
                lecture.pageCount ? `${lecture.pageCount}쪽` : null,
                sizeLabel(lecture.byteSize),
              ].filter(Boolean)

              return (
                <li key={lecture.id}>
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
            })}
          </ul>
        </>
      )}
    </section>
  )
}
