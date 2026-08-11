import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ResetProgressMenu } from '@/components/ResetProgressMenu'
import { ProgressBar } from '@/components/ui/ProgressBadge'
import { Spinner } from '@/components/ui/Spinner'
import { accuracy, useData } from '@/lib/data'
import { fetchOpenSession, type StudySession } from '@/lib/queries/study'

const SESSION_LABEL: Record<string, string> = {
  sequential: '순서대로 풀기',
  block_test: '블록테스트',
  wrong_only: '오답 재풀이',
  bookmark: '북마크 재풀이',
}

const TILE_COLORS = [
  'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
]

export function StudyHomePage() {
  const { taxonomy, loading, subjectProgress } = useData()

  // 진행 중인 세션이 있으면 이어풀기 버튼을 띄운다.
  const [openSession, setOpenSession] = useState<StudySession | null>(null)
  useEffect(() => {
    let active = true
    void fetchOpenSession()
      .then((found) => {
        if (active) setOpenSession(found)
      })
      .catch((caught: unknown) => console.error('세션을 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-7 w-7" />
      </div>
    )
  }

  const subjects = taxonomy?.subjects ?? []

  return (
    <section>
      <header className="mb-4">
        <h1 className="text-xl font-bold">학습하기</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          과목을 선택해 단원별로 문제를 풀어보세요.
        </p>
      </header>

      {openSession && openSession.questionIds.length > 0 && (
        <Link
          to={`/solve?session=${openSession.id}`}
          className="mb-4 flex items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 p-3 transition-colors hover:border-brand-500 dark:border-brand-800 dark:bg-brand-900/30"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
            ▶
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">이어풀기</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {SESSION_LABEL[openSession.mode] ?? '학습'}, {openSession.currentIndex + 1} /{' '}
              {openSession.questionIds.length}
            </span>
          </span>
        </Link>
      )}

      {subjects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">등록된 과목이 없습니다.</p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((subject, index) => {
            const progress = subjectProgress(subject.id)
            const rate = accuracy(progress)
            const unitCount = taxonomy?.units.filter((u) => u.subjectId === subject.id).length ?? 0

            return (
              <li key={subject.id}>
                <Link
                  to={`/study/${subject.id}`}
                  className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold ${
                        TILE_COLORS[index % TILE_COLORS.length]
                      }`}
                    >
                      {subject.name.slice(0, 1)}
                    </span>

                    <div className="min-w-0 flex-1">
                      <h2 className="truncate font-semibold">{subject.name}</h2>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        단원 {unitCount}개
                        {rate !== null && ` 정답률 ${rate}%`}
                      </p>
                    </div>

                    <ResetProgressMenu label={subject.name} scope={{ subjectId: subject.id }} />
                  </div>

                  <div className="mt-3">
                    <ProgressBar progress={progress} />
                    <p className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {progress.solved} / {progress.total} 문제
                    </p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
