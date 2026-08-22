import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { StemBlocks } from '@/components/question/StemBlocks'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import {
  fetchQuestions,
  fetchQuestionsByIds,
  revealAnswers,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { fetchSolutionsForQuestions } from '@/lib/queries/solutions'
import { fetchAiSolutionsForQuestions } from '@/lib/queries/aiSolutions'
import { fetchSeniorSolutionsForQuestions } from '@/lib/queries/seniorSolutions'
import { fetchAccessPermissions } from '@/lib/queries/permissions'
import { examShortLabel, examYearLabel } from '@/lib/queries/taxonomy'
import { fetchBookmarkedQuestions, fetchWrongNotes } from '@/lib/queries/study'
import { circled, formatAnswer, type AnswerPayload } from '@/types/question'
import { type RichDoc } from '@/types/richtext'
import { cn } from '@/utils/cn'

/**
 * 문제집 인쇄 화면.
 *
 * 브라우저 인쇄 대화상자에서 "PDF 로 저장" 하면 문제집이 된다.
 * PDF 생성 라이브러리를 넣지 않은 이유는 번들이 크게 늘고, 한글 폰트를 따로
 * 담아야 하며, 결과물 품질도 브라우저 인쇄만 못하기 때문이다.
 *
 * 범위는 오답노트 화면과 같은 조건을 URL 로 받아 다시 조회한다.
 * 문항 id 를 URL 에 늘어놓지 않아 주소가 짧고 새로고침해도 그대로 열린다.
 */

/** 풀이 출처를 고르는 체크박스의 키. 스터디는 권한 키를 그대로 쓴다. */
const AI_KEY = '__ai__'
const SENIOR_KEY = '__senior__'
const PUBLIC_KEY = '__public__'

/** 문제와 풀이를 지면에 어떻게 앉힐지. */
type Layout = 'stack' | 'split' | 'separate'

const LAYOUT_LABEL: Record<Layout, string> = {
  stack: '세로형',
  split: '좌우 분할',
  separate: '문제집 / 풀이집 분리',
}

type PrintSolution = {
  key: string
  /** 출처 배지에 찍는 이름. AI 풀이 / 선배해설 / 스터디 이름. */
  sourceLabel: string
  authorName: string | null
  content: RichDoc
}

type Loaded = {
  key: string
  questions: SolveQuestion[]
  answers: Map<string, AnswerPayload>
  /** 문항 id -> 그 문항에 붙일 풀이 전부. 출처 구분은 각 항목이 들고 있다. */
  solutions: Map<string, PrintSolution[]>
}

export function PrintPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { taxonomy } = useData()

  const sourceParam = params.get('source')
  const source = sourceParam === 'bookmark' ? 'bookmark' : sourceParam === 'exam' ? 'exam' : 'wrong'
  const subjectId = params.get('subject')
  const unitId = params.get('unit')
  const examId = params.get('exam')
  const cohort = params.get('cohort')

  const [withAnswer, setWithAnswer] = useState(params.get('answer') !== '0')
  const [layout, setLayout] = useState<Layout>('stack')
  const solutionOffByDefault = params.get('solution') === '0'

  // 켜진 목록이 아니라 "끈 목록"을 들고 있다. 출처 목록은 조회가 끝나야
  // 정해지는데, 켜진 목록으로 두면 조회 전 빈 상태와 전부 끈 상태가
  // 구별되지 않아 초기화 순서에 끌려다닌다.
  const [excluded, setExcluded] = useState<Set<string> | null>(null)

  const [permissionNames, setPermissionNames] = useState<Map<string, string>>(new Map())
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestKey = [source, subjectId ?? '', unitId ?? '', examId ?? '', cohort ?? ''].join('|')

  useEffect(() => {
    let active = true
    void fetchAccessPermissions()
      .then((rows) => {
        if (active) setPermissionNames(new Map(rows.map((row) => [row.key, row.name])))
      })
      .catch((caught: unknown) => console.error('공개범위 이름을 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true

    async function load() {
      try {
        let questions: SolveQuestion[]
        if (source === 'exam') {
          if (!examId) throw new Error('시험 정보가 없습니다.')
          questions = await fetchQuestions({ examId })
        } else {
          const ids =
            source === 'bookmark'
              ? (await fetchBookmarkedQuestions()).map((row) => row.questionId)
              : (await fetchWrongNotes({ subjectId, unitId, examId, cohort })).map(
                  (row) => row.questionId,
                )
          questions = await fetchQuestionsByIds(ids)
        }

        const questionIds = questions.map((row) => row.id)
        // 셋 다 RLS가 권한으로 걸러주므로 여기서 권한을 따로 확인하지 않는다.
        // 못 볼 출처는 애초에 빈 결과로 와서 체크박스에도 나타나지 않는다.
        const [answers, studySolutions, aiSolutions, seniorSolutions] = await Promise.all([
          revealAnswers(questionIds),
          fetchSolutionsForQuestions(
            questions.map((row) => ({ questionId: row.id, groupId: row.groupId })),
          ),
          fetchAiSolutionsForQuestions(questionIds),
          fetchSeniorSolutionsForQuestions(questionIds),
        ])

        const solutions = new Map<string, PrintSolution[]>()
        for (const question of questions) {
          const list: PrintSolution[] = []

          const ai = aiSolutions.get(question.id)
          if (ai) {
            list.push({
              key: `${AI_KEY}:${ai.id}`,
              sourceLabel: AI_KEY,
              authorName: null,
              content: ai.content,
            })
          }

          const senior = seniorSolutions.get(question.id)
          if (senior) {
            list.push({
              key: `${SENIOR_KEY}:${senior.id}`,
              sourceLabel: SENIOR_KEY,
              authorName: null,
              content: senior.content,
            })
          }

          for (const solution of studySolutions.get(question.id) ?? []) {
            list.push({
              key: solution.id,
              sourceLabel: solution.requiredPermission ?? PUBLIC_KEY,
              authorName: solution.author.displayName,
              content: solution.content,
            })
          }

          if (list.length > 0) solutions.set(question.id, list)
        }

        if (!active) return
        setLoaded({ key: requestKey, questions, answers, solutions })
        setError(null)
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '문제집을 만들지 못했습니다.')
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [source, subjectId, unitId, examId, cohort, requestKey])

  const examLabelOf = useMemo(() => {
    return (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const subjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, subjectName)
    }
  }, [taxonomy])

  const ready = loaded?.key === requestKey
  const questions = ready ? loaded.questions : []

  const sourceLabelOf = useMemo(() => {
    return (key: string) => {
      if (key === AI_KEY) return 'AI 풀이'
      if (key === SENIOR_KEY) return '선배해설'
      if (key === PUBLIC_KEY) return '전체공개 풀이'
      return permissionNames.get(key) ?? key
    }
  }, [permissionNames])

  // 실제로 담긴 풀이가 있는 출처만 체크박스로 세운다. 권한은 있는데 이 범위에
  // 풀이가 하나도 없는 출처까지 늘어놓으면 무엇을 끄고 켠 건지 알기 어렵다.
  const sources = useMemo(() => {
    if (!ready) return []
    const keys = new Set<string>()
    for (const list of loaded.solutions.values()) {
      for (const item of list) keys.add(item.sourceLabel)
    }
    const order = (key: string) => (key === AI_KEY ? 0 : key === SENIOR_KEY ? 1 : 2)
    return [...keys]
      .sort((a, b) => order(a) - order(b) || sourceLabelOf(a).localeCompare(sourceLabelOf(b), 'ko'))
      .map((key) => ({ key, label: sourceLabelOf(key) }))
  }, [ready, loaded, sourceLabelOf])

  const off = useMemo(
    () => excluded ?? new Set<string>(solutionOffByDefault ? sources.map((item) => item.key) : []),
    [excluded, solutionOffByDefault, sources],
  )

  const isOn = (key: string) => !off.has(key)
  const onCount = sources.filter((item) => isOn(item.key)).length

  function toggleSource(key: string, next: boolean) {
    const draft = new Set(off)
    if (next) draft.delete(key)
    else draft.add(key)
    setExcluded(draft)
  }

  function toggleAll(next: boolean) {
    setExcluded(next ? new Set() : new Set(sources.map((item) => item.key)))
  }

  function solutionsFor(questionId: string): PrintSolution[] {
    if (!ready) return []
    return (loaded.solutions.get(questionId) ?? []).filter((item) => isOn(item.sourceLabel))
  }

  const exam = source === 'exam' && examId ? taxonomy?.examById.get(examId) : undefined
  const examSubjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined

  const title =
    source === 'exam'
      ? exam
        ? `${examSubjectName ?? ''} ${examYearLabel(exam)}`.trim()
        : '시험 문제집'
      : source === 'bookmark'
        ? '북마크 문제집'
        : '오답 문제집'

  /** 지문과 선지. 정답 표시는 세로형·좌우형에서만 선지에 굵게 남긴다. */
  function renderQuestion(question: SolveQuestion, answer: AnswerPayload | null, markAnswer: boolean) {
    return (
      <div className="rounded-lg bg-slate-50 p-3">
        <StemBlocks blocks={question.stemBlocks} />

        {question.choices.length > 0 && (
          <ol className="mt-2 space-y-1">
            {question.choices.map((choice) => {
              const isAnswer = markAnswer && (answer?.editorAnswer.includes(choice.no) ?? false)
              return (
                <li
                  key={choice.no}
                  className={cn('flex gap-2 text-[15px] leading-6', isAnswer && 'font-bold')}
                >
                  <span className="shrink-0">{circled(choice.no)}</span>
                  <span>{choice.text ?? '(이미지 보기)'}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    )
  }

  /** 정답·원본해설·풀이. 세 레이아웃이 위치만 바꿔 같은 내용을 쓴다. */
  function renderAnswerAndSolutions(question: SolveQuestion, answer: AnswerPayload | null) {
    const solutions = solutionsFor(question.id)
    const hasAnswerBlock = withAnswer && answer !== null
    if (!hasAnswerBlock && solutions.length === 0) return null

    return (
      <>
        {withAnswer && answer && (
          <div className="mt-2 border-l-4 border-slate-800 bg-slate-50 py-1.5 pl-3 text-sm">
            <p>
              <span className="font-bold">정답</span>{' '}
              {answer.editorAnswer.length > 0 ? formatAnswer(answer.editorAnswer) : '미확정'}
              {answer.yamaAnswer &&
                answer.yamaAnswer.length > 0 &&
                answer.editorAnswer.join() !== answer.yamaAnswer.join() && (
                  <span className="ml-2 text-slate-500">
                    야마답 {formatAnswer(answer.yamaAnswer)}
                  </span>
                )}
            </p>
            {answer.answerNote && <p className="mt-0.5 text-slate-600">{answer.answerNote}</p>}
            {answer.modelAnswer && (
              <p className="mt-0.5 whitespace-pre-wrap text-slate-600">{answer.modelAnswer}</p>
            )}
          </div>
        )}

        {withAnswer && answer?.officialExplanation && answer.officialExplanation.length > 0 && (
          <div className="mt-2 text-sm">
            <p className="font-semibold">원본 해설</p>
            <StemBlocks blocks={answer.officialExplanation} />
          </div>
        )}

        {solutions.map((solution) => (
          <div key={solution.key} className="mt-3 border-t border-slate-200 pt-2">
            <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <span className="rounded bg-slate-200 px-1.5 py-0.5 font-semibold text-slate-700">
                {sourceLabelOf(solution.sourceLabel)}
              </span>
              {solution.authorName && <span>{solution.authorName}</span>}
            </p>
            <RichTextViewer doc={solution.content} className="solution-rich-text" />
          </div>
        ))}
      </>
    )
  }

  /** 어느 시험 몇 번인지 알려주는 머리말. 세 레이아웃이 같은 자리에 쓴다. */
  function renderMeta(question: SolveQuestion) {
    return (
      <div className="mb-1 text-xs text-slate-500">
        {examLabelOf(question.examId)} {question.questionNumber}번
        {question.unitId ? ` / ${taxonomy?.unitById.get(question.unitId)?.name ?? '미분류'}` : ''}
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0 dark:bg-slate-950">
      {/* 인쇄물에는 나가지 않는 설정 막대 */}
      <div className="mx-auto mb-4 max-w-[210mm] space-y-2 px-4 print:hidden">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            돌아가기
          </Button>

          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={withAnswer}
              onChange={(event) => setWithAnswer(event.target.checked)}
            />
            정답·해설 포함
          </label>

          <span className="flex items-center gap-1 text-sm">
            <span className="text-slate-500">배치</span>
            {(Object.keys(LAYOUT_LABEL) as Layout[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLayout(value)}
                className={cn(
                  'rounded-md px-2 py-1 text-sm transition-colors',
                  layout === value
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {LAYOUT_LABEL[value]}
              </button>
            ))}
          </span>

          <Button className="ml-auto" onClick={() => window.print()} disabled={!ready}>
            인쇄 또는 PDF 저장
          </Button>
        </div>

        {sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2 dark:bg-slate-900">
            <span className="text-sm text-slate-500">풀이 포함</span>
            <label className="flex items-center gap-1 text-sm font-medium">
              <input
                type="checkbox"
                checked={onCount === sources.length}
                // 일부만 켠 상태를 체크박스에 그대로 보여준다.
                ref={(node) => {
                  if (node) node.indeterminate = onCount > 0 && onCount < sources.length
                }}
                onChange={(event) => toggleAll(event.target.checked)}
              />
              전체
            </label>
            {sources.map((item) => (
              <label key={item.key} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={isOn(item.key)}
                  onChange={(event) => toggleSource(item.key, event.target.checked)}
                />
                {item.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {error ? (
        <p className="mx-auto max-w-[210mm] rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : !ready ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-7 w-7" />
        </div>
      ) : questions.length === 0 ? (
        <p className="mx-auto max-w-[210mm] rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          담을 문제가 없습니다.
        </p>
      ) : (
        <article className="mx-auto max-w-[210mm] bg-white p-8 text-slate-900 shadow-sm print:p-0 print:shadow-none">
          <header className="mb-6 border-b-2 border-slate-800 pb-3">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              총 {questions.length}문항
              {withAnswer ? ', 정답·해설 포함' : ''}
              {onCount > 0
                ? `, 풀이 ${sources
                    .filter((item) => isOn(item.key))
                    .map((item) => item.label)
                    .join('·')}`
                : ''}
              {layout !== 'stack' ? ` (${LAYOUT_LABEL[layout]})` : ''}
            </p>
            {source === 'exam' && exam?.overview && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{exam.overview}</p>
            )}
          </header>

          <ol className={layout === 'separate' ? 'space-y-6' : 'space-y-8'}>
            {questions.map((question, position) => {
              const answer = loaded.answers.get(question.id) ?? null

              return (
                <li key={question.id} className="break-inside-avoid">
                  {renderMeta(question)}
                  <div className="flex gap-2">
                    <span className="shrink-0 text-base font-bold">{position + 1}.</span>
                    <div className="min-w-0 flex-1">
                      {/* 분리형은 앞쪽에 문제만 싣고 정답·풀이를 뒤로 몰아 둔다.
                          좌우형은 같은 줄에서 왼쪽 문제 / 오른쪽 풀이로 가른다. */}
                      {layout === 'separate' ? (
                        renderQuestion(question, answer, false)
                      ) : layout === 'split' ? (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="min-w-0">{renderQuestion(question, answer, withAnswer)}</div>
                          <div className="min-w-0 text-sm">
                            {renderAnswerAndSolutions(question, answer)}
                          </div>
                        </div>
                      ) : (
                        <>
                          {renderQuestion(question, answer, withAnswer)}
                          {renderAnswerAndSolutions(question, answer)}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          {layout === 'separate' && (withAnswer || onCount > 0) && (
            <section style={{ breakBefore: 'page' }} className="mt-10">
              <h2 className="mb-4 border-b-2 border-slate-800 pb-2 text-xl font-bold">
                정답 및 풀이
              </h2>
              <ol className="space-y-6">
                {questions.map((question, position) => {
                  const answer = loaded.answers.get(question.id) ?? null
                  const body = renderAnswerAndSolutions(question, answer)
                  if (!body) return null

                  return (
                    <li key={question.id} className="break-inside-avoid text-sm">
                      <div className="flex gap-2">
                        <span className="shrink-0 text-base font-bold">{position + 1}.</span>
                        <div className="min-w-0 flex-1">{body}</div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
        </article>
      )}
    </div>
  )
}
