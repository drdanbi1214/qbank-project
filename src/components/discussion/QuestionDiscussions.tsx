import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DiscussionComposer } from '@/components/discussion/DiscussionComposer'
import { DiscussionDetail } from '@/components/discussion/DiscussionDetail'
import { DiscussionListItem } from '@/components/discussion/DiscussionListItem'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { fetchDiscussions, type DiscussionListItem as Item } from '@/lib/queries/discussions'

const PREVIEW_COUNT = 5

/**
 * 문제 화면 하단의 커뮤니티 Q&A 섹션.
 * 목록 항목은 게시판 탭과 같은 컴포넌트를 재사용한다.
 */
export function QuestionDiscussions({
  questionId,
  unitId,
  stem,
  pendingQuote = null,
  onQuoteHandled,
}: {
  questionId: string
  unitId: string | null
  stem: string | null
  /** 본문에서 Q 를 눌러 넘어온 인용문 */
  pendingQuote?: string | null
  onQuoteHandled?: () => void
}) {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [reloadKey, setReloadKey] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; items: Item[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<{ type: 'list' } | { type: 'write' } | { type: 'read'; id: string }>({
    type: 'list',
  })

  const requestKey = `${questionId}|${reloadKey}`
  const ready = loaded?.key === requestKey

  useEffect(() => {
    let active = true
    void fetchDiscussions({ questionId, sort: 'recent', limit: PREVIEW_COUNT + 1 })
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
  }, [questionId, requestKey])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  // 본문에서 Q 를 눌러 인용문이 넘어오면 작성 폼을 연다.
  // 상태를 따로 맞추지 않고 파생시켜, 인용문이 사라지면 원래 화면으로 돌아간다.
  const view = pendingQuote ? ({ type: 'write' } as const) : mode

  const items = ready ? loaded.items : []
  const hasMore = items.length > PREVIEW_COUNT
  const visible = items.slice(0, PREVIEW_COUNT)

  if (view.type === 'write') {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <DiscussionComposer
          key={pendingQuote ?? 'blank'}
          userId={userId}
          questionId={questionId}
          questionUnitId={unitId}
          questionStem={stem}
          initialQuote={pendingQuote}
          onSaved={(id) => {
            onQuoteHandled?.()
            reload()
            setMode({ type: 'read', id })
          }}
          onCancel={() => {
            onQuoteHandled?.()
            setMode({ type: 'list' })
          }}
        />
      </section>
    )
  }

  if (view.type === 'read') {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <DiscussionDetail
          discussionId={view.id}
          onBack={() => {
            reload()
            setMode({ type: 'list' })
          }}
          onDeleted={() => {
            reload()
            setMode({ type: 'list' })
          }}
        />
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-bold">커뮤니티 Q&amp;A</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            위 문제와 관련된 게시글이에요.
          </p>
        </div>
        <Button size="sm" onClick={() => setMode({ type: 'write' })}>
          게시글 작성하기
        </Button>
      </header>

      {error ? (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : !ready ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5" />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
          아직 등록된 게시글이 없어요
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-700">
            {visible.map((item) => (
              <li key={item.id}>
                <DiscussionListItem item={item} onSelect={() => setMode({ type: 'read', id: item.id })} />
              </li>
            ))}
          </ul>

          {hasMore && (
            <div className="mt-2 text-center">
              <Link
                to={`/discussions?question=${questionId}`}
                className="text-sm text-brand-600 hover:underline dark:text-brand-300"
              >
                더보기
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  )
}
