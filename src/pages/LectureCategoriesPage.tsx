import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  createLectureCategory,
  deleteLectureCategory,
  fetchLectureCategories,
  renameLectureCategory,
  type LectureCategory,
} from '@/lib/queries/lectures'

/**
 * 강의록 첫 화면. 분류를 먼저 고르고 그 안에서 강의록을 본다.
 *
 * 분류는 임상 과목(내과·외과…)과 별개다. subjects 는 문항·시험·단원·알렌이
 * 물고 있어 손댈 수 없고, 강의록을 나누는 축은 그것과 다르기 때문이다.
 */
export function LectureCategoriesPage() {
  const { isAdmin } = useAuth()
  const [rows, setRows] = useState<LectureCategory[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    void fetchLectureCategories()
      .then((next) => active && setRows(next))
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '분류를 불러오지 못했습니다.')
        setRows([])
      })
    return () => {
      active = false
    }
  }, [nonce])

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setNonce((value) => value + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">강의록</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            분류를 골라 그 안의 강의록을 봅니다.
          </p>
        </div>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setAdding((open) => !open)}>
            {adding ? '취소' : '+ 과목 추가'}
          </Button>
        )}
      </header>

      {adding && isAdmin && (
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim() || busy) return
            void run(async () => {
              await createLectureCategory(name)
              setName('')
              setAdding(false)
            }, '분류를 만들지 못했습니다.')
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="분류 이름 (예: 심혈관계)"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950"
          />
          <Button type="submit" disabled={!name.trim() || busy}>
            추가
          </Button>
        </form>
      )}

      {error && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {rows === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-7 w-7" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isAdmin
              ? '아직 분류가 없습니다. 오른쪽 위 “과목 추가”로 만들어 주세요.'
              : '아직 등록된 강의록 분류가 없습니다.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((category) => (
            <li
              key={category.id}
              className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white pr-2 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
            >
              <Link to={`/lectures/c/${category.id}`} className="min-w-0 flex-1 px-4 py-3">
                <span className="block truncate text-sm font-medium">{category.name}</span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  강의록 {category.documentCount}개
                </span>
              </Link>

              {isAdmin && (
                <span className="flex shrink-0 gap-0.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt('분류 이름', category.name)
                      if (!next?.trim() || next.trim() === category.name) return
                      void run(
                        () => renameLectureCategory(category.id, next),
                        '이름을 바꾸지 못했습니다.',
                      )
                    }}
                  >
                    이름
                  </Button>
                  {/* 강의록이 남아 있으면 DB 제약이 막는다. 빈 분류만 지워진다. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || category.documentCount > 0}
                    title={
                      category.documentCount > 0
                        ? '안에 강의록이 있어 지울 수 없습니다.'
                        : undefined
                    }
                    onClick={() => {
                      if (!window.confirm(`“${category.name}” 분류를 지울까요?`)) return
                      void run(() => deleteLectureCategory(category.id), '분류를 지우지 못했습니다.')
                    }}
                  >
                    삭제
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
