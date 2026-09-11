import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StemBlocks } from '@/components/question/StemBlocks'
import { ChoiceList } from '@/components/question/ChoiceList'
import { QuestionLookup } from '@/components/question/QuestionLookup'
import { useCluster } from '@/components/question/useCluster'
import { TopicSolutionBox } from '@/components/question/TopicSolutionBox'
import { useTopicScope } from '@/components/question/TopicContext'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import {
  fetchQuestionById,
  revealAnswer,
  submitAttempt,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { effectiveAnswer, formatAnswer, type AnswerPayload } from '@/types/question'
import {
  recordClusterAttachFailure,
  setVariantNote,
  type ClusterSibling,
  type VariantType,
} from '@/lib/queries/clusters'
import { cn } from '@/utils/cn'

type Props = {
  questionId: string | null
  /** 편집기에서 노드가 선택된 상태 */
  selected?: boolean
  /** 편집기에서만 넘어온다. 있으면 빼기·묶기 버튼을 보여준다. */
  onRemove?: () => void
}

/** Supabase의 PostgrestError는 Error 인스턴스가 아닐 수 있어 메시지를 직접 꺼낸다. */
function messageOf(caught: unknown, fallback: string): string {
  if (
    typeof caught === 'object' &&
    caught !== null &&
    'message' in caught &&
    typeof caught.message === 'string' &&
    caught.message.trim() !== ''
  ) {
    return caught.message
  }
  return caught instanceof Error && caught.message ? caught.message : fallback
}

function codeOf(caught: unknown): string | null {
  return typeof caught === 'object' && caught !== null && 'code' in caught && typeof caught.code === 'string'
    ? caught.code
    : null
}

/**
 * 테마 본문 안에 그려지는 야마 카드.
 *
 * 대표와 유사 문제를 카드 수에 따라 1~3열로 나눈다. 한두 문제뿐일 때는 빈 열을
 * 만들지 않고 가능한 폭을 전부 쓰며, 좁은 화면에서는 모두 세로로 쌓인다.
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
      .then(async (found) => {
        // 완전히 동일한 판본을 본문에 골라도 실제 카드인 기준 문제를 중심으로
        // 그려야 대표가 빠지지 않고 전체 묶음이 보인다.
        const card = found?.sameAs ? (await fetchQuestionById(found.sameAs) ?? found) : found
        if (active) setQuestion(card ?? 'missing')
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
 * 판본을 최대 3열에 같은 크기 카드로 깐다. 카드 안에 그 문제의 해설이 작은
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
  const topicScope = useTopicScope()
  const editing = Boolean(onRemove)
  const canCluster = editing && (isAdmin || hasPermission('study_legendob'))

  const { groupId, cards, identicalOf, attach, detach } = useCluster(
    question.id,
    question.groupId,
  )

  /** 어느 카드에 무엇을 붙이는 중인지 */
  const [adding, setAdding] = useState<{ anchorId: string; variant: VariantType } | null>(null)
  const [peeking, setPeeking] = useState<ClusterSibling | null>(null)

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

  // 한 문제면 카드가 본문 폭을 전부 쓰고, 두 문제면 반씩, 세 문제 이상이면
  // 최대 3열로 둔다. 고정 3열이면 한두 문제뿐일 때 오른쪽이 비고 카드가
  // 불필요하게 좁아진다.
  const cardCount = cards.length + 1
  const columnClass = editing
    ? cardCount >= 3
      ? 'grid gap-2.5 lg:grid-cols-3'
      : cardCount === 2
        ? 'grid gap-2.5 lg:grid-cols-2'
        : 'grid gap-2.5'
    : cardCount >= 3
      ? 'lg:columns-3 lg:gap-x-2.5'
      : cardCount === 2
        ? 'lg:columns-2 lg:gap-x-2.5'
        : undefined

  return (
    <div
      className={cn(
        'rounded-lg border-l-2 border-sky-500 bg-sky-100/80 px-3 py-2.5 dark:border-sky-600 dark:bg-sky-950/35',
        selected && 'ring-2 ring-brand-500',
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span
          data-drag-handle={editing ? '' : undefined}
          className={cn(
            'rounded bg-sky-600 px-1.5 py-0.5 font-semibold text-white',
            editing && 'cursor-grab active:cursor-grabbing',
          )}
        >
          야마
        </span>
        <span className="text-slate-500 dark:text-slate-400">
          유사 문제 {cards.length + 1}개
        </span>
        <span className="ml-auto flex items-center gap-2">
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
        className={columnClass}
      >
        <QuestionCard
          key={`${question.id}-${topicScope?.yamaDisplayMode ?? 'all'}`}
          className={editing ? undefined : 'mb-2.5 break-inside-avoid'}
          kind="anchor"
          questionId={question.id}
          examLabel={`${examLabel(question.examId)} ${question.questionNumber}번`}
          stemBlocks={question.stemBlocks}
          choices={question.choices}
          note={null}
          identical={identicalOf.get(question.id) ?? []}
          solutionGroupId={groupId}
          preparing={false}
          canCluster={canCluster}
          examLabelOf={examLabel}
          onPeek={setPeeking}
          onAdd={(variant) => setAdding({ anchorId: question.id, variant })}
          onDetach={detach}
          interactive={!editing}
          defaultView={topicScope?.yamaDisplayMode === 'solve' ? 'question' : 'solution'}
        />

        {orderedCards.map((row) => (
          <QuestionCard
            key={`${row.id}-${topicScope?.yamaDisplayMode ?? 'all'}`}
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
            interactive={!editing}
            defaultView={topicScope?.yamaDisplayMode === 'solve' ? 'question' : 'solution'}
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
          groupId={groupId}
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
            examLabelOf={examLabel}
            confirmLabel="이 문제로 확정"
            onCancel={() => setAdding(null)}
            onPick={async (found) => {
              try {
                await attach(found.id, adding.variant, adding.anchorId)
                setAdding(null)
              } catch (caught) {
                const message = messageOf(caught, '문제 묶기에 실패했습니다. 잠시 후 다시 시도해 주세요.')
                await recordClusterAttachFailure({
                  anchorId: adding.anchorId,
                  targetId: found.id,
                  variant: adding.variant,
                  errorMessage: message,
                  errorCode: codeOf(caught),
                }).catch((logError: unknown) => {
                  // 진단 기록 자체가 실패해도 원래 실패 원인은 반드시 사용자에게 보인다.
                  console.error('야마 묶기 실패 기록을 남기지 못했습니다.', logError)
                })
                window.alert(message)
              }
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
  interactive,
  defaultView,
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
  interactive: boolean
  defaultView: 'question' | 'solution'
}) {
  const { refreshProgress } = useData()
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState(note ?? '')
  const [showSolution, setShowSolution] = useState(defaultView === 'solution')
  const [selectedChoices, setSelectedChoices] = useState<number[]>([])
  const [answer, setAnswer] = useState<AnswerPayload | null>(null)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [graded, setGraded] = useState(false)
  const [grading, setGrading] = useState(false)
  const [gradeError, setGradeError] = useState<string | null>(null)
  const [authoringYamaAnswer, setAuthoringYamaAnswer] = useState<number[] | null>(null)
  const startedAt = useRef(0)

  useEffect(() => {
    startedAt.current = Date.now()
  }, [])

  // 레옵스 작성자는 해설을 쓰면서 복기 당시의 Y답을 확인할 수 있어야 한다.
  // 읽기 화면에서는 문제를 풀기 전에 정답 요청 자체를 하지 않아 미리 노출되지 않는다.
  useEffect(() => {
    if (interactive) return
    let active = true
    void revealAnswer(questionId)
      .then((revealed) => {
        if (active) setAuthoringYamaAnswer(revealed?.yamaAnswer ?? [])
      })
      .catch(() => {
        if (active) setAuthoringYamaAnswer([])
      })
    return () => {
      active = false
    }
  }, [interactive, questionId])

  // 해설이 펼쳐졌는데 정답이 아직 없으면 받아온다. '풀이 바로 보기' 를 눌렀을
  // 때와, '풀이 한번에 보기' 로 들어와 처음부터 펼쳐진 채 시작할 때가 모두 여기로
  // 온다. 예전에는 둘 다 showSolution 만 올려서, 정답 표시가 하나도 없는 선지
  // 목록이 그려졌다. 채점 기록은 남기지 않는다.
  //
  // '문제 먼저 보기' 에서는 풀기 전까지 showSolution 이 false 라 여기 오지 않는다.
  // 정답을 미리 요청하지 않는다는 규칙은 그대로다.
  const [revealError, setRevealError] = useState<string | null>(null)
  useEffect(() => {
    if (!interactive || !showSolution || answer) return
    let active = true
    void revealAnswer(questionId)
      .then((revealed) => {
        if (!active) return
        setAnswer(revealed)
        setRevealError(null)
      })
      .catch((caught: unknown) => {
        if (active) setRevealError(messageOf(caught, '정답을 불러오지 못했습니다.'))
      })
    return () => {
      active = false
    }
  }, [interactive, showSolution, answer, questionId])

  const grade = useCallback(async () => {
    if (selectedChoices.length === 0 || grading) return
    setGrading(true)
    setGradeError(null)
    try {
      const result = await submitAttempt({
        questionId,
        selected: selectedChoices,
        timeSpentSec: Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)),
      })
      setAnswer(result.answer)
      setIsCorrect(result.isCorrect)
      setGraded(true)
      setShowSolution(true)
      refreshProgress()
    } catch (caught) {
      setGradeError(caught instanceof Error ? caught.message : '채점하지 못했습니다.')
    } finally {
      setGrading(false)
    }
  }, [grading, questionId, selectedChoices, refreshProgress])

  return (
    <section
      className={cn(
        'rounded-lg border bg-white p-3 dark:bg-slate-900',
        kind === 'anchor'
          ? 'border-sky-300 shadow-sm dark:border-sky-700'
          : 'border-sky-200 dark:border-sky-800',
        className,
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-bold',
            kind === 'anchor'
              ? 'bg-sky-600 text-white'
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

      {/* 카드 안에서는 해설이 주인공이다. 문제 지문은 선지와 같은 크기·굵기로
          낮춰, 본문 중간에서 문제만 지나치게 튀지 않게 한다. */}
      <div>
        <StemBlocks blocks={stemBlocks} compact />
      </div>
      {interactive ? (
        <div className="mt-1.5 text-sm">
          <ChoiceList
            choices={choices}
            selected={selectedChoices}
            onChange={setSelectedChoices}
            revealed={showSolution ? answer : null}
            disabled={showSolution}
            compact
          />
        </div>
      ) : (
        <ol className="mt-1.5 space-y-0.5 text-[13px] leading-snug">
          {choices.map((choice) => {
            const isYamaAnswer = !interactive && authoringYamaAnswer?.includes(choice.no)
            return (
              <li
                key={choice.no}
                className={cn(
                  'flex items-start gap-1.5 rounded px-1 py-0.5 text-slate-700 dark:text-slate-300',
                  isYamaAnswer &&
                    'bg-yellow-200/80 font-semibold text-slate-900 dark:bg-yellow-400/25 dark:text-yellow-100',
                )}
              >
                <span className="min-w-0 flex-1">{choice.text ?? '(이미지 보기)'}</span>
                {isYamaAnswer && (
                  <span className="shrink-0 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    Y답
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {interactive && !showSolution && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void grade()}
            disabled={selectedChoices.length === 0 || grading}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {grading ? '채점 중…' : '채점하기'}
          </button>
          <button
            type="button"
            onClick={() => setShowSolution(true)}
            className="px-1 py-1.5 text-xs text-slate-500 hover:text-sky-700 dark:text-slate-400 dark:hover:text-sky-300"
          >
            풀이 바로 보기
          </button>
          {gradeError && (
            <span className="text-xs text-rose-600 dark:text-rose-400">{gradeError}</span>
          )}
        </div>
      )}

      {interactive && showSolution && !answer && revealError && (
        <p role="alert" className="mt-2.5 rounded-md bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {revealError}
        </p>
      )}

      {interactive && showSolution && answer && (
        <p
          className={cn(
            'mt-2.5 rounded-md px-2.5 py-1.5 text-xs font-bold',
            isCorrect === true
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
              : isCorrect === false
                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
          )}
        >
          {isCorrect === true
            ? `정답입니다 · ${formatAnswer(effectiveAnswer(answer))}`
            : isCorrect === false
              ? `오답입니다 · 정답 ${formatAnswer(effectiveAnswer(answer))}`
              : graded
                ? `채점되었습니다 · 정답 ${formatAnswer(effectiveAnswer(answer))}`
                : `정답 ${formatAnswer(effectiveAnswer(answer))}`}
        </p>
      )}

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

      {showSolution && (preparing ? (
        <div className="mt-2.5 flex justify-center py-3">
          <Spinner className="h-4 w-4" />
        </div>
      ) : (
        <TopicSolutionBox
          questionId={questionId}
          groupId={solutionGroupId}
          choiceCount={choices.length}
        />
      ))}
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
                  {choice.text ?? '(이미지 보기)'}
                </li>
              ))}
            </ol>
          </section>
          <section className="border-t border-slate-200 pt-3 dark:border-slate-700">
            <TopicSolutionBox
              questionId={row.id}
              groupId={groupId}
              choiceCount={row.choices.length}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
