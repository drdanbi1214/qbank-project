import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { Spinner } from '@/components/ui/Spinner'
import { fetchTopic, fetchTopicsForQuestion, type TopicForQuestion } from '@/lib/queries/topics'
import type { RichDoc } from '@/types/richtext'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string
  /** 레옵스 스터디원에게만 보인다 */
  enabled: boolean
  /** 풀이 목록 안에 딸려 들어갈 때. 소속이 드러나도록 안쪽으로 들여 그린다. */
  nested?: boolean
}

/**
 * 문제 풀이 화면의 이론 카드.
 *
 * 해설 아래에 접힌 채로 붙는다. 이론 본문은 캡처를 포함해 길 수 있는데, 문제를
 * 풀다가 세 스크롤짜리 이론이 튀어나오면 흐름이 끊긴다. 세 줄 미리보기를 두고
 * 펼칠 때 본문을 가져온다.
 */
export function TopicPanel({ questionId, enabled, nested = false }: Props) {
  const [topics, setTopics] = useState<TopicForQuestion[] | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void fetchTopicsForQuestion(questionId)
      .then((rows) => {
        if (active) setTopics(rows)
      })
      .catch(() => {
        if (active) setTopics([])
      })
    return () => {
      active = false
    }
  }, [questionId, enabled])

  if (!enabled || topics === null || topics.length === 0) return null

  return (
    <section className={cn('space-y-2', nested && 'border-l-2 border-emerald-300 pl-3')}>
      {nested && (
        <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
          이 문제가 실린 테마
        </p>
      )}
      {topics.map((topic) => (
        <TopicCard key={topic.id} topic={topic} />
      ))}
    </section>
  )
}

function TopicCard({ topic }: { topic: TopicForQuestion }) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState<RichDoc | null>(null)
  // 펼치기 전에는 받아온 적이 없으므로 로딩 상태로 시작한다.
  const [loading, setLoading] = useState(true)

  // 본문은 펼칠 때 가져온다. 목록 조회에 본문까지 실으면 문제마다 무거워진다.
  useEffect(() => {
    if (!open || content) return
    let active = true
    void fetchTopic(topic.id)
      .then((found) => {
        if (active) setContent(found?.content ?? null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, content, topic.id])

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white">
          테마
        </span>
        <span className="font-medium text-slate-800 dark:text-slate-100">{topic.title}</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="text-emerald-700 hover:underline dark:text-emerald-300"
          >
            {open ? '접기' : '펼치기'}
          </button>
          <Link
            to={`/topics/${topic.subjectId}/${topic.id}`}
            className="text-slate-500 hover:underline dark:text-slate-400"
          >
            전체 보기
          </Link>
        </span>
      </div>

      {!open && topic.preview !== '' && (
        <p className="line-clamp-3 px-3 pb-2 text-sm text-slate-600 dark:text-slate-300">
          {topic.preview}
        </p>
      )}

      {open && (
        <div className="border-t border-emerald-300 px-3 py-3 dark:border-emerald-800">
          {loading || !content ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-4 w-4" />
            </div>
          ) : (
            <RichTextViewer doc={content} />
          )}
        </div>
      )}
    </div>
  )
}
