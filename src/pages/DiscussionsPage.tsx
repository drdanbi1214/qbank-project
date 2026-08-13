import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DiscussionComposer } from '@/components/discussion/DiscussionComposer'
import { DiscussionDetail } from '@/components/discussion/DiscussionDetail'
import { DiscussionListItem } from '@/components/discussion/DiscussionListItem'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import {
  DISCUSSION_CATEGORIES,
  fetchDiscussions,
  type DiscussionCategory,
  type DiscussionListItem as Item,
  type DiscussionSort,
} from '@/lib/queries/discussions'
import { cn } from '@/utils/cn'

const SORTS: { value: DiscussionSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'top', label: '추천순' },
  { value: 'replies', label: '댓글많은순' },
  { value: 'views', label: '조회순' },
]

/**
 * 게시판 탭.
 * 웹에서는 좌측 목록과 우측 상세를 나란히 두고, 모바일에서는 상세를 전체 화면으로 바꾼다.
 */
export function DiscussionsPage() {
  const [params, setParams] = useSearchParams()
  const { session } = useAuth()
  const { taxonomy } = useData()
  const userId = session?.user.id ?? ''

  // 문제 화면의 `게시판에 문의하기` 로 들어오면 그 문제 글만 본다.
  const questionId = params.get('question')
  const selectedId = params.get('post')

  const [category, setCategory] = useState<DiscussionCategory | null>(null)
  const [status, setStatus] = useState<'open' | 'resolved' | null>(null)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [cohort, setCohort] = useState<string | null>(null)
  const [linkedOnly, setLinkedOnly] = useState(false)
  const [sort, setSort] = useState<DiscussionSort>('recent')
  const [writing, setWriting] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; items: Item[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cohorts = useMemo(
    () => [...new Set((taxonomy?.exams ?? []).map((exam) => exam.cohort))].sort(),
    [taxonomy],
  )

  const requestKey = [
    questionId ?? '',
    category ?? '',
    status ?? '',
    subjectId ?? '',
    cohort ?? '',
    linkedOnly,
    sort,
    reloadKey,
  ].join('|')

  useEffect(() => {
    let active = true
    void fetchDiscussions({
      questionId: questionId ?? undefined,
      category,
      status,
      subjectId,
      cohort,
      linkedOnly,
      sort,
    })
      .then((items) => {
        if (active) {
          setLoaded({ key: requestKey, items })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '게시글을 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [questionId, category, status, subjectId, cohort, linkedOnly, sort, requestKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params)
      if (id) next.set('post', id)
      else next.delete('post')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const ready = loaded?.key === requestKey
  const items = ready ? loaded.items : []

  const selectClass =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none dark:border-slate-700 dark:bg-slate-900'

  const list = (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        <CategoryTab active={category === null} onClick={() => setCategory(null)}>
          전체
        </CategoryTab>
        {DISCUSSION_CATEGORIES.map((item) => (
          <CategoryTab key={item} active={category === item} onClick={() => setCategory(item)}>
            {item}
          </CategoryTab>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={status ?? ''}
          onChange={(event) =>
            setStatus(event.target.value === '' ? null : (event.target.value as 'open' | 'resolved'))
          }
          className={selectClass}
          aria-label="상태"
        >
          <option value="">상태 전체</option>
          <option value="open">미해결</option>
          <option value="resolved">해결됨</option>
        </select>

        <select
          value={subjectId ?? ''}
          onChange={(event) => setSubjectId(event.target.value || null)}
          className={selectClass}
          aria-label="과목"
        >
          <option value="">과목 전체</option>
          {(taxonomy?.subjects ?? []).map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>

        <select
          value={cohort ?? ''}
          onChange={(event) => setCohort(event.target.value || null)}
          className={selectClass}
          aria-label="학번"
        >
          <option value="">학번 전체</option>
          {cohorts.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={linkedOnly}
            onChange={(event) => setLinkedOnly(event.target.checked)}
          />
          문제 연결된 글만
        </label>

        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as DiscussionSort)}
          className={`${selectClass} ml-auto`}
          aria-label="정렬"
        >
          {SORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : !ready ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          조건에 맞는 게시글이 없습니다.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white px-3 dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-900">
          {items.map((item) => (
            <li key={item.id}>
              <DiscussionListItem
                item={item}
                showCategory
                selected={item.id === selectedId}
                onSelect={() => select(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  if (writing) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <DiscussionComposer
          userId={userId}
          questionId={questionId}
          onSaved={(id) => {
            setWriting(false)
            reload()
            select(id)
          }}
          onCancel={() => setWriting(false)}
        />
      </section>
    )
  }

  return (
    <section>
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">게시판</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {questionId
              ? '선택한 문제에 달린 게시글입니다.'
              : '문제 풀이 중 생긴 궁금증을 나눕니다.'}
          </p>
        </div>
        <Button onClick={() => setWriting(true)}>게시글 작성하기</Button>
      </header>

      {/*
        상세는 한 번만 마운트한다. 예전에는 모바일용과 웹용을 각각 두고 CSS 로 감췄는데,
        숨겨진 쪽도 그대로 살아 있어서 글과 댓글을 두 번씩 불러왔다.
        웹에서는 좌우로 나란히, 모바일에서는 목록과 상세 중 하나만 보이게 한다.
      */}
      <div className="min-w-0 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-5">
        <div className={cn('min-w-0', selectedId && 'hidden lg:block')}>{list}</div>

        <div className={cn('min-w-0', !selectedId && 'hidden lg:block')}>
          {selectedId ? (
            <div className="min-w-0 max-w-full lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white lg:p-4 lg:dark:border-slate-700 lg:dark:bg-slate-900">
              <DiscussionDetail
                key={selectedId}
                discussionId={selectedId}
                backOnMobileOnly
                onBack={() => {
                  reload()
                  select(null)
                }}
                onDeleted={() => {
                  reload()
                  select(null)
                }}
              />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 p-10 dark:border-slate-700">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                왼쪽에서 게시글을 선택해주세요.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function CategoryTab({
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
        'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}
