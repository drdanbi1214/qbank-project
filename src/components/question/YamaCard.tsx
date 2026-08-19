import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { StemBlocks } from '@/components/question/StemBlocks'
import { QuestionLookup } from '@/components/question/QuestionLookup'
import { useCluster } from '@/components/question/useCluster'
import { TopicSolutionBox } from '@/components/question/TopicSolutionBox'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { fetchQuestionById, type SolveQuestion } from '@/lib/queries/questions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { setVariantNote, type ClusterSibling, type VariantType } from '@/lib/queries/clusters'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string | null
  /** 편집기에서 노드가 선택된 상태 */
  selected?: boolean
  /** 편집기에서만 넘어온다. 있으면 빼기·묶기 버튼을 보여준다. */
  onRemove?: () => void
}

/**
 * 테마 본문 안에 그려지는 야마 카드.
 *
 * 좌(문제) · 우(해설) 로 나누고, 유사 문제는 아래에 전체 폭으로 깐다. 변주는
 * 문제 전체를 봐야 하는데 좁은 칼럼에 넣으면 원본과 무엇이 다른지 비교가 되지
 * 않는다. 넓은 화면에서만 2단이고 좁으면 세로로 쌓인다.
 *
 * 문제를 못 가져오면 자리표시자를 그린다. 지워졌거나, 시험이 draft 거나, 보는
 * 사람에게 그 학번 열람 권한이 없는 경우다. 본문 흐름은 끊기지 않는다.
 */
export function YamaCard({ questionId, selected = false, onRemove }: Props) {
  const { taxonomy } = useData()
  const [question, setQuestion] = useState<SolveQuestion | null | 'missing'>(
    questionId ? null : 'missing',
  )

  useEffect(() => {
    if (!questionId) return
    let active = true
    void fetchQuestionById(questionId)
      .then((found) => {
        if (active) setQuestion(found ?? 'missing')
      })
      .catch(() => {
        if (active) setQuestion('missing')
      })
    return () => {
      active = false
    }
  }, [questionId])

  if (question === null) {
    return (
      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
        <Spinner className="h-4 w-4" />
      </div>
    )
  }

  if (question === 'missing') {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400',
          selected && 'ring-2 ring-brand-500',
        )}
      >
        이 야마는 지금 볼 수 없습니다. 문제가 지워졌거나, 해당 학번 열람 권한이 없습니다.
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-2 text-xs underline hover:text-rose-600 dark:hover:text-rose-400"
          >
            본문에서 빼기
          </button>
        )}
      </div>
    )
  }

  return (
    <YamaBody
      question={question}
      selected={selected}
      subjectId={taxonomy?.examById.get(question.examId)?.subjectId ?? null}
      onRemove={onRemove}
    />
  )
}

// -----------------------------------------------------------------------------


/**
 * 문제를 받아온 뒤의 본문. 훅 순서가 흔들리지 않도록 컴포넌트를 나눴다.
 *
 * 판본을 2열 격자에 같은 크기 카드로 깐다. 카드 안에 그 문제의 해설이 작은
 * 박스로 들어가고, 그 카드와 글자까지 같은 판본은 칩으로 붙는다. 격자 전체가
 * 하나의 유사 문제 묶음이다.
 */
function YamaBody({
  question,
  selected,
  subjectId,
  onRemove,
}: {
  question: SolveQuestion
  selected: boolean
  subjectId: string | null
  onRemove?: () => void
}) {
  const { taxonomy } = useData()
  const { isAdmin, hasPermission } = useAuth()
  const editing = Boolean(onRemove)
  const canCluster = editing && (isAdmin || hasPermission('study_legendob'))

  const { groupId, cards, identicalOf, attach, detach, ensureGroup } = useCluster(
    question.id,
    question.groupId,
  )

  /** 어느 카드에 무엇을 붙이는 중인지 */
  const [adding, setAdding] = useState<{ anchorId: string; variant: VariantType } | null>(null)
  const [peeking, setPeeking] = useState<ClusterSibling | null>(null)
  const [solutionGroupId, setSolutionGroupId] = useState<string | null>(groupId)
  const preparing = canCluster && solutionGroupId === null

  const examLabel = useCallback(
    (examId: string) => {
      const exam = taxonomy?.examById.get(examId)
      const name = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, name)
    },
    [taxonomy],
  )

  /**
   * 이미지가 있는 카드를 뒤로 보낸다.
   *
   * 열 흐름은 DOM 순서대로 채우면서 높이를 맞춘다. 그래서 X-ray 가 붙은 긴
   * 카드가 앞에 있으면 그것만으로 첫 열이 절반을 넘겨 거기서 끊기고, 남은 짧은
   * 카드들이 둘째 열로 몰려 아래가 크게 빈다. 긴 것을 마지막에 두면 짧은
   * 카드들이 먼저 쌓이고 긴 것이 옆 열에 서서 빈 곳이 거의 없어진다.
   *
   * 편집 중에는 격자라 순서를 건드릴 이유가 없다. 쓰던 카드가 갑자기 자리를
   * 옮기면 오히려 헷갈린다.
   */
  const orderedCards = useMemo(() => {
    if (editing) return cards
    const hasImage = (row: ClusterSibling) =>
      row.stemBlocks.some((block) => block.type === 'image')
    return [...cards].sort((a, b) => Number(hasImage(a)) - Number(hasImage(b)))
  }, [cards, editing])

  // 해설은 항상 그룹에 붙인다. 그룹 없이 문제에 붙이면 나중에 판본을 묶어도
  // 해설이 따라가지 않는다. 테마에 꽂힌 야마는 어차피 묶을 대상이므로 미리 만든다.
  useEffect(() => {
    if (!canCluster || solutionGroupId) return
    let active = true
    void ensureGroup()
      .then((id) => {
        if (active) setSolutionGroupId(id)
      })
      .catch((caught: unknown) => console.error('야마 그룹을 준비하지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [canCluster, solutionGroupId, ensureGroup])

  return (
    <div
      className={cn(
        'rounded-lg border-l-2 border-emerald-500 bg-emerald-50/40 px-3 py-2.5 dark:bg-emerald-950/20',
        selected && 'ring-2 ring-brand-500',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          data-drag-handle={editing ? '' : undefined}
          className={cn(
            'rounded bg-emerald-600 px-1.5 py-0.5 font-semibold text-white',
            editing && 'cursor-grab active:cursor-grabbing',
          )}
        >
          야마
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          유사 문제 {cards.length + 1}개
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Link
            to={`/solve?question=${question.id}`}
            className="text-brand-600 hover:underline dark:text-brand-300"
          >
            풀어보기
          </Link>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-slate-400 underline hover:text-rose-600 dark:hover:text-rose-400"
            >
              빼기
            </button>
          )}
        </span>
      </div>

      {/*
        읽을 때는 열 흐름(메이슨리)으로 깐다. 카드가 자기 높이만 써서 짧은 문제
        옆에 빈 공간이 생기지 않는다.

        편집할 때는 격자로 되돌린다. 카드 안에 편집기가 있어서, 해설을 타이핑하면
        카드가 세로로 자라는데 열 흐름에서는 그때마다 뒤 카드들이 다른 열로 튄다.
        격자는 행 단위라 그 행만 커지고 다른 카드가 움직이지 않는다.
      */}
      <div
        className={cn(
          editing ? 'grid gap-2.5 lg:grid-cols-2' : 'lg:columns-2 lg:gap-x-2.5',
        )}
      >
        <QuestionCard
          className={editing ? undefined : 'mb-2.5 break-inside-avoid'}
          kind="anchor"
          questionId={question.id}
          examLabel={`${examLabel(question.examId)} ${question.questionNumber}번`}
          stemBlocks={question.stemBlocks}
          choices={question.choices}
          note={null}
          identical={identicalOf.get(question.id) ?? []}
          solutionGroupId={solutionGroupId}
          preparing={preparing}
          canCluster={canCluster}
          examLabelOf={examLabel}
          onPeek={setPeeking}
          onAdd={(variant) => setAdding({ anchorId: question.id, variant })}
          onDetach={detach}
        />

        {orderedCards.map((row) => (
          <QuestionCard
            key={row.id}
            className={editing ? undefined : 'mb-2.5 break-inside-avoid'}
            kind="variant"
            questionId={row.id}
            examLabel={`${examLabel(row.examId)} ${row.questionNumber}번`}
            stemBlocks={row.stemBlocks}
            choices={row.choices}
            note={row.variantNote}
            identical={identicalOf.get(row.id) ?? []}
            // 카드마다 자기 해설을 갖는다. 공유 해설은 기준 카드에만 붙는다.
            solutionGroupId={null}
            preparing={false}
            canCluster={canCluster}
            examLabelOf={examLabel}
            onPeek={setPeeking}
            onAdd={(variant) => setAdding({ anchorId: row.id, variant })}
            onDetach={detach}
          />
        ))}

        {canCluster && (
          <button
            type="button"
            onClick={() => setAdding({ anchorId: question.id, variant: 'modified' })}
            className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600"
          >
            + 유사 문제 추가
          </button>
        )}
      </div>

      {peeking && (
        <QuestionPeek
          row={peeking}
          groupId={solutionGroupId}
          title={`${examLabel(peeking.examId)} ${peeking.questionNumber}번`}
          onClose={() => setPeeking(null)}
        />
      )}

      {adding && taxonomy && (
        <div className="mt-2.5 rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
          <h4 className="mb-2 text-sm font-semibold">
            {adding.variant === 'identical' ? '완전히 동일한 문제' : '유사 문제'} 추가
          </h4>
          <QuestionLookup
            exams={taxonomy.exams}
            subjectId={subjectId}
            excludeQuestionId={question.id}
            rejectGrouped
            examLabelOf={examLabel}
            confirmLabel="이 문제로 확정"
            onCancel={() => setAdding(null)}
            onPick={(found) => {
              void attach(found.id, adding.variant, adding.anchorId)
                .then(() => setAdding(null))
                .catch((caught: unknown) => {
                  window.alert(caught instanceof Error ? caught.message : '묶지 못했습니다.')
                })
            }}
          />
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------

/**
 * 격자에 깔리는 문제 카드 하나.
 *
 * 문제 → 그 밑에 작은 해설박스. 카드마다 자기 해설을 가지므로 어느 판본에 대한
 * 설명인지 헷갈리지 않는다. 글자까지 같은 판본은 칩으로만 붙는다 — 내용이 같아
 * 본문을 반복할 이유가 없다.
 */
function QuestionCard({
  className,
  kind,
  questionId,
  examLabel,
  stemBlocks,
  choices,
  note,
  identical,
  solutionGroupId,
  preparing,
  canCluster,
  examLabelOf,
  onPeek,
  onAdd,
  onDetach,
}: {
  className?: string
  kind: 'anchor' | 'variant'
  questionId: string
  examLabel: string
  stemBlocks: SolveQuestion['stemBlocks']
  choices: SolveQuestion['choices']
  note: string | null
  identical: ClusterSibling[]
  solutionGroupId: string | null
  preparing: boolean
  canCluster: boolean
  examLabelOf: (examId: string) => string
  onPeek: (row: ClusterSibling) => void
  onAdd: (variant: VariantType) => void
  onDetach: (id: string) => void
}) {
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState(note ?? '')

  return (
    <section
      className={cn(
        'rounded-lg border bg-white p-3 dark:bg-slate-900',
        kind === 'anchor'
          ? 'border-slate-300 shadow-sm dark:border-slate-600'
          : 'border-slate-300 dark:border-slate-600',
        className,
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-bold',
            kind === 'anchor'
              ? 'bg-emerald-600 text-white'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
          )}
        >
          {kind === 'anchor' ? '대표' : '유사'}
        </span>
        <span className="font-semibold text-slate-700 dark:text-slate-200">{examLabel}</span>
        {kind === 'variant' && !editingNote && (
          <span className="text-amber-700 dark:text-amber-400">
            {noteValue || '지문이 조금 다릅니다'}
          </span>
        )}
        {canCluster && kind === 'variant' && !editingNote && (
          <button
            type="button"
            onClick={() => setEditingNote(true)}
            className="text-slate-400 underline hover:text-slate-600"
          >
            차이 메모
          </button>
        )}
        {canCluster && (
          <button
            type="button"
            onClick={() => onDetach(questionId)}
            className="ml-auto text-slate-300 hover:text-rose-500"
            aria-label="이 판본 묶기 풀기"
            title="이 판본 묶기 풀기"
          >
            ✕
          </button>
        )}
      </div>

      {editingNote && (
        <input
          autoFocus
          value={noteValue}
          onChange={(event) => setNoteValue(event.target.value)}
          onBlur={() => {
            setEditingNote(false)
            void setVariantNote(questionId, noteValue).catch((caught: unknown) => {
              window.alert(caught instanceof Error ? caught.message : '메모를 저장하지 못했습니다.')
            })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          placeholder="예: 묻는 방향이 반대입니다 / 숫자만 바뀜"
          className="mb-1.5 w-full rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs dark:border-amber-800 dark:bg-amber-950/30"
        />
      )}

      <div className="text-[15px] font-semibold leading-relaxed">
        <StemBlocks blocks={stemBlocks} />
      </div>
      <ol className="mt-1.5 space-y-0.5 text-sm">
        {choices.map((choice) => (
          <li key={choice.no} className="text-slate-700 dark:text-slate-300">
            {choice.text}
          </li>
        ))}
      </ol>

      {(identical.length > 0 || canCluster) && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          {identical.length > 0 && <span>완전히 동일</span>}
          {identical.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onPeek(row)}
              className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700 hover:border-brand-400 hover:text-brand-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              {examLabelOf(row.examId)} {row.questionNumber}번
            </button>
          ))}
          {canCluster && (
            <button
              type="button"
              onClick={() => onAdd('identical')}
              className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-slate-400 hover:border-brand-400 hover:text-brand-600 dark:border-slate-600"
            >
              + 완전히 동일한 문제
            </button>
          )}
        </p>
      )}

      {preparing ? (
        <div className="mt-2.5 flex justify-center py-3">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <TopicSolutionBox questionId={questionId} groupId={solutionGroupId} />
      )}
    </section>
  )
}

// -----------------------------------------------------------------------------

/**
 * 완전히 동일한 판본 훑어보기.
 *
 * 내용이 같아 격자에 카드로 깔 이유는 없지만, 그 학번 시험지에 실제로 어떻게
 * 실렸는지 확인하고 싶을 때가 있다. 문제 아래에 해설까지 이어 붙인다.
 */
function QuestionPeek({
  row,
  groupId,
  title,
  onClose,
}: {
  row: ClusterSibling
  groupId: string | null
  title: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            완전히 동일
          </span>
          <h3 className="text-sm font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          <section>
            <StemBlocks blocks={row.stemBlocks} />
            <ol className="mt-2 space-y-0.5 text-sm">
              {row.choices.map((choice) => (
                <li key={choice.no} className="text-slate-700 dark:text-slate-300">
                  {choice.text}
                </li>
              ))}
            </ol>
          </section>
          <section className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <TopicSolutionBox questionId={row.id} groupId={groupId} />
          </section>
        </div>
      </div>
    </div>
  )
}
