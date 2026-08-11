import { useCallback, useEffect, useMemo, useState } from 'react'
import { SolutionCard } from '@/components/solution/SolutionCard'
import { SolutionEditor } from '@/components/solution/SolutionEditor'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import {
  fetchInlineComments,
  fetchSolutions,
  type InlineComment,
  type Solution,
  type SolutionSort,
  type SolutionTarget,
} from '@/lib/queries/solutions'
import { cn } from '@/utils/cn'

export function SolutionList({
  questionId,
  groupId,
  autoWrite = false,
}: {
  questionId: string
  groupId: string | null
  /** 배정 화면에서 들어온 경우 작성창을 펼친 채로 시작한다 */
  autoWrite?: boolean
}) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  // 조회 대상을 고정해 두어야 목록을 다시 불러오는 조건이 흔들리지 않는다.
  const target = useMemo<SolutionTarget>(() => ({ questionId, groupId }), [questionId, groupId])

  const [sort, setSort] = useState<SolutionSort>('top')
  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    solutions: Solution[]
    comments: InlineComment[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** null 이면 보기 모드, 'new' 면 새 글, 그 외에는 수정할 풀이 id */
  const [editing, setEditing] = useState<string | null>(autoWrite ? 'new' : null)

  const requestKey = `${target.groupId ?? target.questionId}|${sort}|${reloadKey}`
  const loading = loaded?.key !== requestKey && error === null

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const solutions = await fetchSolutions(target, sort)
        const comments = await fetchInlineComments(solutions.map((item) => item.id))
        if (!active) return
        setLoaded({ key: requestKey, solutions, comments })
        setError(null)
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '풀이를 불러오지 못했습니다.')
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [target, sort, requestKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  const solutions = loaded?.key === requestKey ? loaded.solutions : []
  const comments = loaded?.key === requestKey ? loaded.comments : []
  const editingSolution = solutions.find((item) => item.id === editing) ?? null

  if (editing !== null) {
    return (
      <SolutionEditor
        key={editing}
        target={target}
        userId={userId}
        existing={editingSolution}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <div className="flex gap-1">
          <SortButton active={sort === 'top'} onClick={() => setSort('top')}>
            추천순
          </SortButton>
          <SortButton active={sort === 'recent'} onClick={() => setSort('recent')}>
            최신순
          </SortButton>
        </div>
        <Button size="sm" className="ml-auto" onClick={() => setEditing('new')}>
          풀이 작성
        </Button>
      </header>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : solutions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            아직 등록된 풀이가 없습니다. 첫 풀이를 남겨보세요.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {solutions.map((solution, index) => (
            <SolutionCard
              key={solution.id}
              solution={solution}
              comments={comments.filter((item) => item.solutionId === solution.id)}
              // 추천순일 때만 맨 위 글을 베스트로 고정 표시한다.
              isBest={sort === 'top' && index === 0 && solution.upvoteCount > 0}
              onEdit={() => setEditing(solution.id)}
              onChanged={reload}
              onCommentsChanged={reload}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function SortButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg px-2.5 py-1 text-sm font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}
