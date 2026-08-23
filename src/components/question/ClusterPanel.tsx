import { StemBlocks } from '@/components/question/StemBlocks'
import { circled } from '@/types/question'
import { useCluster } from '@/components/question/useCluster'

type Props = {
  questionId: string
  initialGroupId: string | null
  examLabelOf: (examId: string) => string
}

/**
 * 문제 풀이 화면의 출제 이력.
 *
 * 읽기 전용이다. 묶고 푸는 일은 테마 본문의 야마 카드에서만 한다 — 비슷한
 * 문제를 모아 함께 설명하는 것은 이론을 쓰면서 하는 일이지 문제를 풀다가 하는
 * 일이 아니다.
 */
export function ClusterPanel({ questionId, initialGroupId, examLabelOf }: Props) {
  const { siblings, cards, identicalOf } = useCluster(questionId, initialGroupId)
  // 이 문제 자신과 글자까지 같은 판본. 배너 한 줄로만 알린다.
  const identical = identicalOf.get(questionId) ?? []

  if (siblings === null || siblings.length === 0) return null

  return (
    <section className="space-y-2">
      {identical.length > 0 && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          이 문제는{' '}
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {identical
              .map((row) => `${examLabelOf(row.examId)} ${row.questionNumber}번`)
              .join(' · ')}
          </span>
          에도 동일 출제됨
        </p>
      )}

      {cards.map((row) => (
        <details
          key={row.id}
          className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
        >
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
              변주
            </span>
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {examLabelOf(row.examId)} {row.questionNumber}번
            </span>
            <span className="text-xs text-amber-700 dark:text-amber-400">지문이 조금 다릅니다</span>
          </summary>
          <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-700">
            <StemBlocks blocks={row.stemBlocks} />
            <ol className="mt-2 space-y-1 text-sm">
              {row.choices.map((choice) => (
                <li key={choice.no} className="flex gap-2 text-slate-700 dark:text-slate-300">
                  {/* 번호를 붙이지 않으면 몇 번 보기인지 알 수 없어, 본문과
                      대조하거나 답을 이야기할 때 가리킬 것이 없다. */}
                  <span className="shrink-0">{circled(choice.no)}</span>
                  <span>{choice.text ?? '(이미지 보기)'}</span>
                </li>
              ))}
            </ol>

            <a
              href={`/solve?question=${row.id}`}
              target="_blank"
              rel="noreferrer"
              // 지금 풀던 문제를 잃지 않도록 새 탭에서 연다.
              className="mt-3 inline-block rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-brand-700 ring-1 ring-slate-300 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:text-brand-300 dark:ring-slate-600 dark:hover:bg-slate-800"
            >
              이 문제 보러가기 ↗
            </a>
          </div>
        </details>
      ))}
    </section>
  )
}
