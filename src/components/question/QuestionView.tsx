import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Spinner } from '@/components/ui/Spinner'
import { AnswerNotice } from '@/components/question/AnswerNotice'
import { ChoiceList } from '@/components/question/ChoiceList'
import { StatsBar } from '@/components/question/StatsBar'
import { StemBlocks } from '@/components/question/StemBlocks'
import { MarkableRegion } from '@/components/marking/MarkableRegion'
import { useTextMarks } from '@/components/marking/useTextMarks'
import { QuestionDiscussions } from '@/components/discussion/QuestionDiscussions'
import { AiSolutionPanel } from '@/components/solution/AiSolutionPanel'
import { AllNotesPanel } from '@/components/solution/AllNotesPanel'
import { PersonalNoteTab } from '@/components/solution/PersonalNoteTab'
import { SeniorSolutionPanel } from '@/components/solution/SeniorSolutionPanel'
import { SolutionList } from '@/components/solution/SolutionList'
import { hasAiSolution } from '@/lib/queries/aiSolutions'
import { hasSeniorSolution } from '@/lib/queries/seniorSolutions'
import { hasSolutions } from '@/lib/queries/solutions'
import { AssignmentEditor } from '@/components/assignments/AssignmentEditor'
import {
  fetchDiscussionCount,
  fetchGroupSiblings,
  fetchStats,
  incrementView,
  revealAnswer,
  setBookmark,
  submitAttempt,
  type QuestionSet,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import {
  COMPLETENESS_LABEL,
  effectiveAnswer,
  formatAnswer,
  type AnswerPayload,
  type QuestionStats,
} from '@/types/question'
import { cn } from '@/utils/cn'

type Props = {
  question: SolveQuestion
  questionSet: QuestionSet | null
  unitName: string | null
  /** `20학번 정신건강의학과` */
  examLabel: string
  examLabelOf: (examId: string) => string
  /** 세션 내 위치 (1-based). 단건 보기면 null */
  position: { index: number; total: number } | null
  bookmarked: boolean
  onBookmarkChange: (next: boolean) => void
  onPrev?: () => void
  onNext?: () => void
  /** 남은 문제 순서를 무작위로 섞는다. 여러 문제를 순서대로 푸는 세션에서만 넘긴다. */
  onShuffle?: () => void
  /** 번호(1-based)를 직접 입력해 이동한다. 0-based index 로 넘겨준다. */
  onJumpTo?: (index: number) => void
  onExit: () => void
  /** 채점이 끝나면 목록 진행률을 갱신하려고 알린다 */
  onAnswered?: (questionId: string, isCorrect: boolean | null) => void
  /** 들어오자마자 정답을 공개한다 (배정받은 문항 풀이 작성용) */
  autoReveal?: boolean
  /** 풀이 작성창을 펼친 상태로 연다 */
  autoWrite?: boolean
}

type SolutionTab = 'solutions' | 'ai' | 'senior' | 'note'

export function QuestionView({
  question,
  questionSet,
  unitName,
  examLabel,
  examLabelOf,
  position,
  bookmarked,
  onBookmarkChange,
  onPrev,
  onNext,
  onShuffle,
  onJumpTo,
  onExit,
  onAnswered,
  autoReveal = false,
  autoWrite = false,
}: Props) {
  const { taxonomy } = useData()
  const { session, isAdmin, hasPermission } = useAuth()
  const userId = session?.user.id ?? ''
  const canViewStudySolutions = hasPermission('study_hapbon3')
  const canViewAiSolution = hasPermission('ai_solution_view')
  const canViewSeniorSolution = hasPermission('senior_solution_view')

  const [selected, setSelected] = useState<number[]>([])
  const [answer, setAnswer] = useState<AnswerPayload | null>(null)
  const [stats, setStats] = useState<QuestionStats | null>(null)
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [siblings, setSiblings] = useState<string[]>([])
  const [threadCount, setThreadCount] = useState(0)

  // 서술형
  const [essayText, setEssayText] = useState('')
  const [graded, setGraded] = useState(false)

  // 권한이 없는 탭은 버튼뿐 아니라 데이터 조회 컴포넌트도 만들지 않는다.
  const [tab, setTab] = useState<SolutionTab>('note')

  // 형광펜. 문제 본문과 원본 해설은 같은 문제 id 를 쓰되 종류로 구분한다.
  const stemMarks = useTextMarks('question', question.id)
  const explanationMarks = useTextMarks('explanation', question.id)

  // 본문에서 Q 를 누르면 그 문장을 인용해 게시글 작성 폼을 연다.
  const [askQuote, setAskQuote] = useState<string | null>(null)

  // 렌더 중에 Date.now() 를 부르지 않도록 마운트 시 채운다.
  const startedAt = useRef<number>(0)
  const isEssay = question.questionType === 'essay'

  // 이 컴포넌트는 호출 측에서 key={question.id} 로 감싸므로 문제가 바뀌면 새로 마운트된다.
  // 따라서 상태를 수동으로 초기화할 필요가 없고, 마운트 시점의 부수효과만 처리한다.
  useEffect(() => {
    startedAt.current = Date.now()
    void incrementView(question.id)
    void fetchDiscussionCount(question.id).then(setThreadCount)
  }, [question.id])

  // 중복 출제 안내
  useEffect(() => {
    if (!question.groupId) return
    let active = true
    void fetchGroupSiblings(question.groupId, question.id)
      .then((rows) => {
        if (!active) return
        const labels = [...new Set(rows.map((row) => examLabelOf(row.examId)))].filter(Boolean)
        setSiblings(labels)
      })
      .catch((caught: unknown) => console.error('동일 출제 정보를 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [question.groupId, question.id, examLabelOf])

  const elapsedSec = useCallback(
    () => Math.max(0, Math.round((Date.now() - startedAt.current) / 1000)),
    [],
  )

  /**
   * 정답 공개 시 내용이 있는 첫 탭을 고른다. 여러 탭에 내용이 있거나 전부
   * 비었으면 풀이 → 선배해설 → AI 풀이 순서를 따른다.
   */
  const findPreferredSolutionTab = useCallback(async (): Promise<SolutionTab> => {
    if (autoWrite) return 'note'

    const candidates: { tab: SolutionTab; check: () => Promise<boolean> }[] = []
    if (canViewStudySolutions) {
      candidates.push({
        tab: 'solutions',
        check: () => hasSolutions({ questionId: question.id, groupId: question.groupId }),
      })
    }
    if (canViewSeniorSolution) {
      candidates.push({ tab: 'senior', check: () => hasSeniorSolution(question.id) })
    }
    if (canViewAiSolution) {
      candidates.push({ tab: 'ai', check: () => hasAiSolution(question.id) })
    }
    if (candidates.length === 0) return 'note'

    const hasContent = await Promise.all(
      candidates.map(async ({ check }) => {
        try {
          return await check()
        } catch (caught) {
          console.error('풀이 탭의 내용 여부를 확인하지 못했습니다.', caught)
          return false
        }
      }),
    )
    const firstWithContent = hasContent.findIndex(Boolean)
    return candidates[firstWithContent >= 0 ? firstWithContent : 0].tab
  }, [
    autoWrite,
    canViewAiSolution,
    canViewSeniorSolution,
    canViewStudySolutions,
    question.groupId,
    question.id,
  ])

  const handleSubmit = useCallback(async () => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    setError(null)
    const spent = elapsedSec()
    try {
      const [result, nextTab] = await Promise.all([
        submitAttempt({
          questionId: question.id,
          selected,
          timeSpentSec: spent,
        }),
        findPreferredSolutionTab(),
      ])
      setTab(nextTab)
      setAnswer(result.answer)
      setStats(result.stats)
      setIsCorrect(result.isCorrect)
      onAnswered?.(question.id, result.isCorrect)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '채점하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [selected, busy, elapsedSec, question.id, onAnswered, findPreferredSolutionTab])

  /** 스킵은 기록을 남기지 않고 정답만 공개한다. */
  const handleSkip = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const [revealed, loaded, nextTab] = await Promise.all([
        revealAnswer(question.id),
        fetchStats(question.id),
        findPreferredSolutionTab(),
      ])
      setTab(nextTab)
      setAnswer(revealed)
      setStats(loaded)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '정답을 불러오지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }, [busy, question.id, findPreferredSolutionTab])

  /**
   * 배정 화면에서 들어온 경우 정답을 자동으로 연다.
   *
   * handleSkip 을 타이머로 부르지 않는 이유가 있다. StrictMode 는 개발 중에
   * 효과를 마운트-정리-마운트 로 두 번 돌리는데, 정리 단계에서 타이머가 취소되고
   * 재실행 때는 중복 방지 플래그에 막혀 영영 실행되지 않았다.
   * 여기서 직접 조회하면 두 번 실행돼도 같은 결과라 안전하다.
   */
  useEffect(() => {
    if (!autoReveal) return
    let active = true

    void Promise.all([
      revealAnswer(question.id),
      fetchStats(question.id),
      findPreferredSolutionTab(),
    ])
      .then(([revealed, loaded, nextTab]) => {
        if (!active) return
        setTab(nextTab)
        setAnswer(revealed)
        setStats(loaded)
      })
      .catch((caught: unknown) => console.error('정답을 불러오지 못했습니다.', caught))

    return () => {
      active = false
    }
  }, [autoReveal, question.id, findPreferredSolutionTab])

  const handleSelfGrade = useCallback(
    async (grade: 'correct' | 'partial' | 'wrong') => {
      if (busy) return
      setBusy(true)
      const spent = elapsedSec()
      try {
        const result = await submitAttempt({
          questionId: question.id,
          selected: [],
          timeSpentSec: spent,
          selfGrade: grade,
        })
        setStats(result.stats)
        setIsCorrect(result.isCorrect)
          setGraded(true)
        onAnswered?.(question.id, result.isCorrect)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '채점 결과를 저장하지 못했습니다.')
      } finally {
        setBusy(false)
      }
    },
    [busy, elapsedSec, question.id, onAnswered],
  )

  async function toggleBookmark() {
    const next = !bookmarked
    onBookmarkChange(next)
    try {
      await setBookmark(question.id, userId, next)
    } catch (caught) {
      onBookmarkChange(!next)
      console.error('북마크를 저장하지 못했습니다.', caught)
    }
  }

  // 게시글에 붙는 문제 카드에 쓸 본문 첫 줄
  const firstStemText =
    question.stemBlocks.find((block) => block.type === 'text')?.content ?? null

  const completenessLabel = COMPLETENESS_LABEL[question.completeness]
  const revealed = answer !== null
  const canSubmit = selected.length > 0 && !revealed

  const resultBanner = useMemo(() => {
    if (!revealed || isCorrect === null) return null
    return isCorrect ? (
      <p className="text-base font-bold text-brand-600 dark:text-brand-300">정답입니다.</p>
    ) : (
      <p className="text-base font-bold text-marker-red">
        오답입니다. 정답은 {formatAnswer(effectiveAnswer(answer))} 입니다.
      </p>
    )
  }, [revealed, isCorrect, answer])

  return (
    <article className="pb-28 lg:pb-8">
      {/* 상단 바 */}
      <header className="mb-4 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {unitName && (
              <p className="truncate text-xs font-medium text-brand-600 dark:text-brand-300">
                {unitName}
              </p>
            )}
            <h1 className="mt-0.5 flex flex-wrap items-center gap-x-2 text-base font-bold">
              <span>{question.questionNumber}번</span>
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                [{examLabel}]
              </span>
              <span className="text-xs font-normal text-slate-400">
                조회 {question.viewCount}
              </span>
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {position && (
              <PositionJump
                position={position}
                onJumpTo={onJumpTo}
                className="mr-1 hidden text-sm tabular-nums text-slate-500 sm:inline dark:text-slate-400"
              />
            )}
            <IconButton label="이전 문제" icon="chevron-right" onClick={onPrev} flip disabled={!onPrev} />
            <IconButton label="다음 문제" icon="chevron-right" onClick={onNext} disabled={!onNext} />
            {onShuffle && <IconButton label="순서 섞기" icon="shuffle" onClick={onShuffle} />}
            <IconButton
              label={bookmarked ? '북마크 해제' : '북마크'}
              icon="wrong-note"
              onClick={() => void toggleBookmark()}
              active={bookmarked}
            />
            <Link
              to={`/discussions?question=${question.id}`}
              title="게시판에 문의하기"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <Icon name="board" size={18} />
              {threadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand-600 px-1 text-[10px] leading-4 text-white">
                  {threadCount}
                </span>
              )}
            </Link>
            <IconButton label="나가기" icon="logout" onClick={onExit} />
          </div>
        </div>

        {position && (
          <PositionJump
            position={position}
            onJumpTo={onJumpTo}
            className="mt-1 block text-sm tabular-nums text-slate-500 sm:hidden dark:text-slate-400"
          />
        )}
      </header>

      {/* R형 공통 선지 */}
      {questionSet && questionSet.sharedChoices.length > 0 && (
        <section className="sticky top-14 z-10 mb-4 rounded-xl border border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          {questionSet.setTitle && (
            <h2 className="text-sm font-semibold">{questionSet.setTitle}</h2>
          )}
          {questionSet.instruction && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {questionSet.instruction}
            </p>
          )}
          <ul className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {questionSet.sharedChoices.map((choice) => (
              <li key={choice.key} className="flex gap-2">
                <span className="font-semibold text-brand-600 dark:text-brand-300">
                  {choice.key}
                </span>
                <span>{choice.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {completenessLabel && (
        <p className="mb-3 inline-block rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          {completenessLabel}
        </p>
      )}

      <MarkableRegion
        onApply={stemMarks.apply}
        onErase={stemMarks.erase}
        // 정답 확인 전에는 질문 버튼을 내린다. 게시글 목록에 정답이 드러날 수 있다.
        onAsk={revealed ? (range) => setAskQuote(range.text) : undefined}
      >
        <StemBlocks blocks={question.stemBlocks} marks={stemMarks.marks} />
      </MarkableRegion>

      {question.restorerNote && (
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">{question.restorerNote}</p>
      )}

      {/* 보기 또는 서술형 답안 */}
      <div className="mt-5">
        {isEssay ? (
          <EssaySection
            value={essayText}
            onChange={setEssayText}
            answer={answer}
            graded={graded}
            busy={busy}
            onReveal={() => void handleSkip()}
            onGrade={(grade) => void handleSelfGrade(grade)}
          />
        ) : (
          <ChoiceList
            choices={question.choices}
            selected={selected}
            onChange={setSelected}
            revealed={answer}
          />
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* 정답 확인 후 영역 */}
      {revealed && (
        <div className="mt-5 space-y-4">
          {resultBanner}

          <AnswerNotice answer={answer} />

          {stats && !autoWrite && <StatsBar stats={stats} />}

          {siblings.length > 0 && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              이 문제는 {siblings.join(', ')} 시험에도 동일 출제됨
            </p>
          )}

          {answer.officialExplanation && answer.officialExplanation.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="mb-2 text-sm font-semibold">원본 해설</h3>
              <MarkableRegion
                onApply={explanationMarks.apply}
                onErase={explanationMarks.erase}
                onAsk={(range) => setAskQuote(range.text)}
              >
                <StemBlocks
                  blocks={answer.officialExplanation}
                  marks={explanationMarks.marks}
                />
              </MarkableRegion>
            </section>
          )}

          {/* 배정 화면에서 들어온 경우 편집자답 체크 + 풀이 작성이 결합된 전용 폼을 연다. */}
          {autoWrite && (
            <AssignmentEditor
              questionId={question.id}
              examId={question.examId}
              groupId={question.groupId}
              choices={question.choices}
              currentEditorAnswer={answer.editorAnswer}
              yamaAnswer={answer.yamaAnswer}
              currentUnitId={question.unitId}
              currentUnitSource={question.unitSource}
              userId={userId}
            />
          )}
        </div>
      )}

      {revealed && (
        <div className="mt-4 space-y-4">
          {/* 탭과 무관하게 항상 보이는 게시판 영역 */}
          <QuestionDiscussions
            questionId={question.id}
            unitId={question.unitId}
            stem={firstStemText}
            pendingQuote={askQuote}
            onQuoteHandled={() => setAskQuote(null)}
          />

          {isAdmin && <AllNotesPanel questionId={question.id} groupId={question.groupId} />}
        </div>
      )}

      {/* 하단 고정 액션. 모바일에서 정답 확인 버튼을 항상 닿는 위치에 둔다. */}
      <div
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-3 py-2 backdrop-blur lg:static lg:mt-6 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none dark:border-slate-800 dark:bg-slate-950/95 lg:dark:bg-transparent"
        style={{ paddingBottom: 'calc(0.5rem + var(--safe-bottom))' }}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          {!revealed && !isEssay && (
            <>
              <Button variant="secondary" onClick={() => void handleSkip()} disabled={busy}>
                스킵
              </Button>
              <Button block size="lg" onClick={() => void handleSubmit()} disabled={!canSubmit || busy}>
                {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                정답 확인
              </Button>
            </>
          )}

          {revealed && (
            <Button block size="lg" onClick={onNext} disabled={!onNext}>
              {onNext ? '다음 문제' : '마지막 문제입니다'}
            </Button>
          )}
        </div>
      </div>

      {/* 내 노트는 정답 공개 전부터 열 수 있다. 공개 후에도 같은 위치와 컴포넌트를
          유지해 저장 전 작성 내용이 사라지지 않게 한다. */}
      {!autoWrite && (
        <div className="mt-5">
          <div className="mb-3 flex gap-1 border-b border-slate-200 dark:border-slate-800">
            {revealed && canViewStudySolutions && (
              <TabButton active={tab === 'solutions'} onClick={() => setTab('solutions')}>
                풀이
              </TabButton>
            )}
            {revealed && canViewAiSolution && (
              <TabButton active={tab === 'ai'} onClick={() => setTab('ai')}>
                AI 풀이
              </TabButton>
            )}
            {revealed && canViewSeniorSolution && (
              <TabButton active={tab === 'senior'} onClick={() => setTab('senior')}>
                선배해설
              </TabButton>
            )}
            <TabButton active={tab === 'note'} onClick={() => setTab('note')}>
              내 노트
            </TabButton>
          </div>

          {revealed && tab === 'solutions' && canViewStudySolutions && (
            <SolutionList
              questionId={question.id}
              groupId={question.groupId}
              choiceCount={question.choices.length}
              subjectId={taxonomy?.examById.get(question.examId)?.subjectId ?? null}
              unitId={question.unitId}
              unitSource={question.unitSource}
            />
          )}
          <div className={tab === 'note' ? undefined : 'hidden'} aria-hidden={tab !== 'note'}>
            <PersonalNoteTab questionId={question.id} groupId={question.groupId} />
          </div>
          {revealed && tab === 'ai' && canViewAiSolution && (
            <AiSolutionPanel questionId={question.id} />
          )}
          {revealed && tab === 'senior' && canViewSeniorSolution && (
            <SeniorSolutionPanel questionId={question.id} />
          )}
        </div>
      )}
    </article>
  )
}

function TabButton({
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
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
          : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400',
      )}
    >
      {children}
    </button>
  )
}

function PositionJump({
  position,
  onJumpTo,
  className,
}: {
  position: { index: number; total: number }
  onJumpTo?: (index: number) => void
  className: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(position.index))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(Math.max(parsed, 1), position.total)
      onJumpTo?.(clamped - 1)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <span className={className}>
        <input
          ref={inputRef}
          type="number"
          min={1}
          max={position.total}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') setEditing(false)
          }}
          onBlur={commit}
          className="w-10 rounded border border-slate-300 bg-white px-1 text-center tabular-nums dark:border-slate-600 dark:bg-slate-800"
        />
        {' / '}
        {position.total}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!onJumpTo) return
        setValue(String(position.index))
        setEditing(true)
      }}
      disabled={!onJumpTo}
      className={cn(className, onJumpTo && 'cursor-pointer hover:underline')}
    >
      {position.index} / {position.total}
    </button>
  )
}

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  active,
  flip,
}: {
  label: string
  icon: 'chevron-right' | 'wrong-note' | 'logout' | 'shuffle'
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  flip?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors disabled:opacity-30',
        active
          ? 'bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300'
          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
      )}
    >
      <Icon name={icon} size={18} className={flip ? 'rotate-180' : undefined} />
    </button>
  )
}

function EssaySection({
  value,
  onChange,
  answer,
  graded,
  busy,
  onReveal,
  onGrade,
}: {
  value: string
  onChange: (next: string) => void
  answer: AnswerPayload | null
  graded: boolean
  busy: boolean
  onReveal: () => void
  onGrade: (grade: 'correct' | 'partial' | 'wrong') => void
}) {
  return (
    <div className="space-y-3">
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={6}
        placeholder="답안을 작성해보세요. 저장되지 않고 자가채점용으로만 쓰입니다."
        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-900"
      />

      {!answer && (
        <Button onClick={onReveal} disabled={busy}>
          모범답안 보기
        </Button>
      )}

      {answer && (
        <div className="space-y-3">
          <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <h3 className="mb-1 text-sm font-semibold">모범답안</h3>
            <p className="whitespace-pre-wrap text-sm leading-6">
              {answer.modelAnswer ?? '등록된 모범답안이 없습니다.'}
            </p>
          </section>

          {answer.gradingPoints && answer.gradingPoints.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="mb-1 text-sm font-semibold">채점 포인트</h3>
              <ul className="list-inside list-disc space-y-0.5 text-sm">
                {answer.gradingPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </section>
          )}

          {!graded ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">자가채점</span>
              <Button size="sm" onClick={() => onGrade('correct')} disabled={busy}>
                맞음
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onGrade('partial')} disabled={busy}>
                부분
              </Button>
              <Button size="sm" variant="danger" onClick={() => onGrade('wrong')} disabled={busy}>
                틀림
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">자가채점을 기록했습니다.</p>
          )}
        </div>
      )}
    </div>
  )
}
