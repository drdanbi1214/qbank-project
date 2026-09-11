import type { CSSProperties, RefObject } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { StemBlocks } from '@/components/question/StemBlocks'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
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
import {
  DEFAULT_PRINT_SETTINGS,
  parsePrintSettings,
  printSettingsKey,
  type PrintSettings,
} from '@/lib/printSettings'
import {
  canSettlePrintLayout,
  EMPTY_PRINT_READINESS,
  failedPrintAssetCount,
  pendingPrintAssetCount,
  PRINT_ASSET_KINDS,
  samePrintReadiness,
  type PrintAssetKind,
  type PrintReadinessSnapshot,
} from '@/lib/printReadiness'
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
type Layout = PrintSettings['layout']

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

type PrintReadiness = PrintReadinessSnapshot & { settled: boolean }

const EMPTY_READINESS: PrintReadiness = { ...EMPTY_PRINT_READINESS, settled: false }

function assetCounts(root: HTMLElement): PrintReadinessSnapshot {
  const images = [...root.querySelectorAll<HTMLImageElement>('img')]
  // 아래쪽의 lazy 이미지도 인쇄 직전에는 전부 받아야 한다. 화면 밖에 있다는
  // 이유로 Chrome이 요청을 미루지 않도록 실제 DOM 속성을 eager로 바꾼다.
  for (const image of images) image.loading = 'eager'

  const countMarkers = (attribute: 'data-print-pending' | 'data-print-failed') => {
    const counts = { image: 0, lecture: 0, allen: 0, yama: 0 }
    for (const element of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const kind = element.getAttribute(attribute)
      if (PRINT_ASSET_KINDS.includes(kind as PrintAssetKind)) {
        counts[kind as PrintAssetKind] += 1
      }
    }
    return counts
  }

  return {
    imageTotal: images.length,
    imageReady: images.filter((image) => image.complete && image.naturalWidth > 0).length,
    imageFailed: images.filter((image) => image.complete && image.naturalWidth === 0).length,
    pending: countMarkers('data-print-pending'),
    failed: countMarkers('data-print-failed'),
    fontsReady: !document.fonts || document.fonts.status === 'loaded',
  }
}

/**
 * 인쇄 문서 안에서 나중에 생기는 자료까지 감시한다.
 *
 * 서명 URL을 받는 동안에는 data-print-pending 표식이 있고, URL을 받은 뒤에는
 * 실제 img의 load/error를 본다. 전부 끝나도 이미지 디코딩과 두 프레임을 더
 * 기다려 다단 배치가 최종 높이로 자리 잡은 뒤에만 settled가 된다.
 */
function usePrintReadiness(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  renderKey: string,
): PrintReadiness {
  const [result, setResult] = useState<{ key: string; value: PrintReadiness }>({
    key: '',
    value: EMPTY_READINESS,
  })

  useEffect(() => {
    const root = rootRef.current
    if (!enabled || !root) return

    let disposed = false
    let firstFrame = 0
    let secondFrame = 0
    let settleTimer = 0
    let decodeTimer = 0
    let lastSnapshot: PrintReadinessSnapshot | null = null

    const cancelSettle = () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      window.clearTimeout(settleTimer)
      window.clearTimeout(decodeTimer)
    }

    const publish = (next: PrintReadinessSnapshot, settled: boolean) => {
      if (disposed) return
      setResult((current) =>
        current.key === renderKey &&
        current.value.settled === settled &&
        samePrintReadiness(current.value, next)
          ? current
          : { key: renderKey, value: { ...next, settled } },
      )
    }

    const scan = () => {
      if (disposed) return
      const snapshot = assetCounts(root)
      // 이미지와 대기 표식이 그대로인데 자식 DOM만 조금 바뀐 경우(필기 SVG 등)
      // 진행 중인 최종 확인을 처음부터 다시 시작하지 않는다. 이런 변화가 계속
      // 생기면 모든 자료를 받았어도 영원히 '지면 배치 확인 중'에 머물 수 있다.
      if (
        lastSnapshot &&
        samePrintReadiness(lastSnapshot, snapshot) &&
        canSettlePrintLayout(snapshot)
      ) {
        return
      }
      cancelSettle()
      lastSnapshot = snapshot
      publish(snapshot, false)
      if (!canSettlePrintLayout(snapshot)) return

      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          settleTimer = window.setTimeout(() => {
            const finalImages = [...root.querySelectorAll<HTMLImageElement>('img')]
            const decoded = Promise.all(
              finalImages.map((image) => {
                // complete + naturalWidth로 이미 표시 가능한 것은 확인했다. decode는
                // 인쇄 직전 화소 준비를 한 번 더 보장하지만, 일부 Chrome 판본과
                // 특정 이미지 형식은 이 Promise를 끝내지 않는 경우가 있다.
                if (typeof image.decode !== 'function') return Promise.resolve()
                return image.decode().catch(() => undefined)
              }),
            )
            const decodeDeadline = new Promise<void>((resolve) => {
              decodeTimer = window.setTimeout(resolve, 1_500)
            })
            void Promise.race([decoded, decodeDeadline]).then(() => {
              window.clearTimeout(decodeTimer)
              const finalSnapshot = assetCounts(root)
              publish(finalSnapshot, canSettlePrintLayout(finalSnapshot))
            })
          }, 250)
        })
      })
    }

    // 이펙트가 시작된 렌더와 같은 틱에서 setState하지 않고, DOM 커밋이 끝난
    // 다음 프레임부터 센다.
    firstFrame = window.requestAnimationFrame(scan)
    const observer = new MutationObserver(scan)
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-print-pending', 'data-print-failed'],
    })
    root.addEventListener('load', scan, true)
    root.addEventListener('error', scan, true)
    document.fonts?.addEventListener('loadingdone', scan)
    document.fonts?.addEventListener('loadingerror', scan)
    void document.fonts?.ready.then(scan)

    return () => {
      disposed = true
      cancelSettle()
      observer.disconnect()
      root.removeEventListener('load', scan, true)
      root.removeEventListener('error', scan, true)
      document.fonts?.removeEventListener('loadingdone', scan)
      document.fonts?.removeEventListener('loadingerror', scan)
    }
  }, [rootRef, enabled, renderKey])

  return enabled && result.key === renderKey ? result.value : EMPTY_READINESS
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
  // 같은 모양으로 여러 번 뽑는 일이 많아 지난번 설정에서 시작한다. 저장이
  // 막혀 있어도 기본값으로 열리기만 하면 되므로 조용히 넘어간다.
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const settingsKey = printSettingsKey(userId)
  const [saved] = useState<PrintSettings>(() => {
    try {
      return parsePrintSettings(localStorage.getItem(printSettingsKey(userId)))
    } catch {
      return { ...DEFAULT_PRINT_SETTINGS }
    }
  })

  const [layout, setLayout] = useState<Layout>(saved.layout)
  // 종이 설정. 화면의 미리보기와 실제 인쇄가 같은 값을 쓴다.
  const [landscape, setLandscape] = useState(saved.landscape)
  const [margin, setMargin] = useState(saved.margin)
  const [scale, setScale] = useState(saved.scale)
  // 좌우 분할에서 문제가 차지하는 비율(%). 가운데 바를 끌어 바꾼다.
  const [splitRatio, setSplitRatio] = useState(saved.splitRatio)
  const [columns, setColumns] = useState(saved.columns)
  const [onePerColumn, setOnePerColumn] = useState(saved.onePerColumn)
  const [columnRule, setColumnRule] = useState(saved.columnRule)
  const [imageWidth, setImageWidth] = useState(saved.imageWidth)
  const [leading, setLeading] = useState(saved.leading)
  // 한 단은 이미 좁다. 거기서 문제와 풀이를 또 좌우로 가르면 글줄이 너무 짧아
  // 읽히지 않는다. 다단에서는 세로형과 분리형만 쓴다.
  const effectiveLayout: Layout = columns > 1 && layout === 'split' ? 'stack' : layout

  useEffect(() => {
    try {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          layout,
          landscape,
          margin,
          scale,
          leading,
          splitRatio,
          imageWidth,
          columns,
          onePerColumn,
          columnRule,
        } satisfies PrintSettings),
      )
    } catch {
      // 저장이 막혀 있어도 이번 판은 그대로 쓸 수 있다. 알릴 일은 아니다.
    }
  }, [settingsKey, layout, landscape, margin, scale, leading, splitRatio, columns, onePerColumn, columnRule, imageWidth])
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
  const articleRef = useRef<HTMLElement>(null)
  const visibleSourceKey = sources
    .filter((item) => isOn(item.key))
    .map((item) => item.key)
    .join(',')
  // 풀이 출처를 바꾸면 같은 개수의 이미지가 우연히 남더라도 새 DOM을 다시
  // 확인해야 한다. 지면 설정도 마지막 배치가 끝난 다음 인쇄하도록 열쇠에 넣는다.
  const readinessRenderKey = [
    requestKey,
    withAnswer ? 'answer' : 'no-answer',
    visibleSourceKey,
    effectiveLayout,
    landscape ? 'landscape' : 'portrait',
    margin,
    scale,
    splitRatio,
    columns,
    onePerColumn ? 'one' : 'flow',
    columnRule ? 'rule' : 'no-rule',
    imageWidth,
    leading,
  ].join('|')
  const readiness = usePrintReadiness(
    articleRef,
    ready && questions.length > 0,
    readinessRenderKey,
  )
  const pendingAssets = pendingPrintAssetCount(readiness)
  const failedAssets = failedPrintAssetCount(readiness)
  const hasLoadFailure = Boolean(error) || failedAssets > 0
  const printReady = ready && questions.length > 0 && readiness.settled

  const loadingDetails = [
    readiness.imageTotal + readiness.pending.image > 0
      ? `이미지 ${readiness.imageReady}/${readiness.imageTotal + readiness.pending.image}`
      : null,
    readiness.pending.lecture > 0 ? `강의록 ${readiness.pending.lecture}개` : null,
    readiness.pending.allen > 0 ? `알렌 ${readiness.pending.allen}개` : null,
    readiness.pending.yama > 0 ? `야마 ${readiness.pending.yama}개` : null,
    !readiness.fontsReady ? '글꼴' : null,
  ].filter((item): item is string => item !== null)

  useEffect(() => {
    const stopEarlyPrint = (event: KeyboardEvent) => {
      if (printReady || event.key.toLowerCase() !== 'p' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      document.querySelector<HTMLElement>('[data-print-status]')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }
    window.addEventListener('keydown', stopEarlyPrint, true)
    return () => window.removeEventListener('keydown', stopEarlyPrint, true)
  }, [printReady])

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

  const paperWidth = landscape ? 297 : 210
  const paperHeight = landscape ? 210 : 297
  // 글이 실제로 놓이는 폭. 화면에서는 안쪽 여백(p-8) 만큼 더 잡아, 미리보기의
  // 글 폭이 인쇄 결과와 같아지게 한다.
  const contentWidth = paperWidth - margin * 2

  const exam = source === 'exam' && examId ? taxonomy?.examById.get(examId) : undefined
  const examSubjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined

  const title =
    source === 'exam'
      ? exam
        ? exam.curriculum
          ? examYearLabel(exam)
          : `${examSubjectName ?? ''} ${examYearLabel(exam)}`.trim()
        : '시험 문제집'
      : source === 'bookmark'
        ? '북마크 문제집'
        : '오답 문제집'

  /** 지문과 선지. 정답 표시는 세로형·좌우형에서만 선지에 굵게 남긴다. */
  function renderQuestion(question: SolveQuestion, answer: AnswerPayload | null, markAnswer: boolean) {
    // 종이에서 slate-50 은 거의 흰색이라 상자 테두리가 보이지 않았다. 한 단계만 올린다.
    return (
      <div className="rounded-lg bg-slate-100 p-3">
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
          <div className="mt-2 border-l-4 border-slate-800 bg-slate-100 py-1.5 pl-3 text-sm">
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
      {/* 도구 모음은 아래 시험지와 같은 폭으로 둔다. 종이를 가로로 돌리면
          시험지만 넓어지고 도구는 좁게 남아 어긋나 보였다. */}
      <div
        style={{ maxWidth: `${paperWidth}mm` }}
        className="mx-auto mb-4 space-y-2 px-4 print:hidden"
      >
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

          <Button
            className="ml-auto"
            onClick={() => {
              if (printReady) window.print()
            }}
            disabled={!printReady}
            title={printReady ? undefined : '모든 자료가 준비되면 인쇄할 수 있습니다.'}
          >
            {printReady ? '인쇄 또는 PDF 저장' : '인쇄 준비 중…'}
          </Button>
        </div>

        <div
          data-print-status=""
          role="status"
          aria-live="polite"
          className={cn(
            'overflow-hidden rounded-lg border bg-white dark:bg-slate-900',
            hasLoadFailure
              ? 'border-amber-300 dark:border-amber-800'
              : printReady
                ? 'border-emerald-300 dark:border-emerald-800'
                : 'border-sky-200 dark:border-sky-800',
          )}
        >
          <div className="flex items-center gap-2 px-3 py-2 text-sm">
            {hasLoadFailure ? (
              <span aria-hidden="true" className="text-amber-600">!</span>
            ) : printReady ? (
              <span aria-hidden="true" className="text-emerald-600">✓</span>
            ) : (
              <Spinner className="h-4 w-4" />
            )}
            <span
              className={cn(
                'font-medium',
                hasLoadFailure
                  ? 'text-amber-800 dark:text-amber-200'
                  : printReady
                    ? 'text-emerald-800 dark:text-emerald-200'
                    : 'text-slate-700 dark:text-slate-200',
              )}
            >
              {error
                ? '문제집 데이터를 불러오지 못했습니다.'
                : !ready
                  ? '문제와 풀이를 불러오는 중입니다…'
                  : questions.length === 0
                    ? '담을 문제가 없습니다.'
                    : failedAssets > 0
                      ? `자료 ${failedAssets}개를 불러오지 못했습니다. 시험지 안의 ‘다시 불러오기’를 눌러주세요.`
                      : printReady
                        ? `인쇄 준비 완료 · 이미지 ${readiness.imageReady}장과 강의록·알렌을 모두 확인했습니다.`
                        : pendingAssets > 0 || !readiness.fontsReady
                          ? `자료를 불러오는 중입니다 · ${loadingDetails.join(' · ')}`
                          : '모든 자료를 받았습니다. 지면 배치를 확인하는 중입니다…'}
            </span>
            {failedAssets > 0 && (
              <button
                type="button"
                onClick={() =>
                  document.querySelector<HTMLElement>('[data-print-failed]')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                  })
                }
                className="ml-auto shrink-0 text-xs font-medium text-amber-700 underline dark:text-amber-300"
              >
                오류 위치 보기
              </button>
            )}
          </div>
          {!printReady && !hasLoadFailure && (!ready || questions.length > 0) && (
            <div className="h-1 bg-sky-100 dark:bg-sky-950">
              <div className="h-full w-2/3 animate-pulse rounded-r-full bg-sky-500" />
            </div>
          )}
          {printReady && <div className="h-1 bg-emerald-500" />}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-white px-3 py-2 dark:bg-slate-900">
          <span className="flex items-center gap-1 text-sm">
            <span className="text-slate-500">용지</span>
            {([false, true] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                onClick={() => setLandscape(value)}
                className={cn(
                  'rounded-md px-2 py-1 text-sm transition-colors',
                  landscape === value
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {value ? 'A4 가로' : 'A4 세로'}
              </button>
            ))}
          </span>

          {/* 여백을 줄이면 글 폭이 넓어진다. 종이 크기를 바꾸지 않고 폭을 늘리는
              길이라, 프린터가 못 찍는 크기로 새어 나갈 걱정이 없다. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">여백</span>
            <input
              type="range"
              min={8}
              max={30}
              step={1}
              value={margin}
              onChange={(event) => setMargin(Number(event.target.value))}
              className="w-28"
            />
            <span className="w-20 tabular-nums text-slate-500">
              {margin}mm · 글 폭 {contentWidth}mm
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">글자</span>
            <input
              type="range"
              min={70}
              max={150}
              step={5}
              value={Math.round(scale * 100)}
              onChange={(event) => setScale(Number(event.target.value) / 100)}
              className="w-28"
            />
            <span className="w-12 tabular-nums text-slate-500">{Math.round(scale * 100)}%</span>
          </label>

          <span className="flex items-center gap-1 text-sm">
            <span className="text-slate-500">단</span>
            {[1, 2, 3].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColumns(value)}
                className={cn(
                  'rounded-md px-2 py-1 text-sm transition-colors',
                  columns === value
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                )}
              >
                {value}단
              </button>
            ))}
          </span>

          {/* 글자만 줄이면 줄 사이가 그대로라 부피가 잘 줄지 않는다. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">줄 간격</span>
            <input
              type="range"
              min={75}
              max={130}
              step={5}
              value={Math.round(leading * 100)}
              onChange={(event) => setLeading(Number(event.target.value) / 100)}
              className="w-24"
            />
            <span className="w-12 tabular-nums text-slate-500">{Math.round(leading * 100)}%</span>
          </label>

          {/* 사진 하나가 한 쪽을 다 먹으면 문제와 풀이가 갈라진다. */}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">사진</span>
            <input
              type="range"
              min={30}
              max={100}
              step={5}
              value={imageWidth}
              onChange={(event) => setImageWidth(Number(event.target.value))}
              className="w-24"
            />
            <span className="w-20 tabular-nums text-slate-500">최대 {imageWidth}%</span>
          </label>

          {columns > 1 && (
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={onePerColumn}
                onChange={(event) => setOnePerColumn(event.target.checked)}
              />
              문항마다 새 단에서 시작
              <span className="text-slate-500">
                (끄면 빈틈없이 이어 흐릅니다)
              </span>
            </label>
          )}

          {columns > 1 && (
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={columnRule}
                onChange={(event) => setColumnRule(event.target.checked)}
              />
              단 사이 구분선
            </label>
          )}

          {effectiveLayout === 'split' && (
            <span className="flex items-center gap-2 text-sm text-slate-500">
              문제 {splitRatio}% · 풀이 {100 - splitRatio}%
              <button
                type="button"
                onClick={() => setSplitRatio(50)}
                className="rounded-md bg-slate-200 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              >
                반반으로
              </button>
            </span>
          )}

          {columns > 1 && layout === 'split' && (
            <span className="text-sm text-amber-700 dark:text-amber-300">
              다단에서는 좌우 분할 대신 세로형으로 싣습니다
            </span>
          )}

          <button
            type="button"
            onClick={() => {
              setColumns(DEFAULT_PRINT_SETTINGS.columns)
              setOnePerColumn(DEFAULT_PRINT_SETTINGS.onePerColumn)
              setColumnRule(DEFAULT_PRINT_SETTINGS.columnRule)
              setImageWidth(DEFAULT_PRINT_SETTINGS.imageWidth)
              setLeading(DEFAULT_PRINT_SETTINGS.leading)
              setLandscape(DEFAULT_PRINT_SETTINGS.landscape)
              setMargin(DEFAULT_PRINT_SETTINGS.margin)
              setScale(DEFAULT_PRINT_SETTINGS.scale)
              setSplitRatio(DEFAULT_PRINT_SETTINGS.splitRatio)
            }}
            className="ml-auto text-sm text-slate-500 underline"
          >
            기본값으로
          </button>
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

      {/* index.css 의 @page 를 이 화면에서만 덮어쓴다. 종이 크기와 여백은 CSS
          변수로 넘길 수 없어, 고른 값으로 규칙을 직접 만들어 끼운다. */}
      <style>
        {`@media print { @page { size: ${paperWidth}mm ${paperHeight}mm; margin: ${margin}mm; } }`}
      </style>

      {!printReady && (
        <div className="mx-auto hidden max-w-[180mm] py-20 text-center print:block">
          <h1 className="text-xl font-bold">인쇄 자료를 아직 준비하고 있습니다.</h1>
          <p className="mt-2 text-sm">
            이 창을 닫고 상단에 ‘인쇄 준비 완료’가 표시된 뒤 다시 인쇄해주세요.
          </p>
        </div>
      )}

      {error ? (
        <p className="mx-auto max-w-[210mm] rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 print:hidden dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      ) : !ready ? (
        <div className="flex justify-center py-20 print:hidden">
          <Spinner className="h-7 w-7" />
        </div>
      ) : questions.length === 0 ? (
        <p className="mx-auto max-w-[210mm] rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 print:hidden dark:border-slate-700 dark:text-slate-400">
          담을 문제가 없습니다.
        </p>
      ) : (
        <article
          ref={articleRef}
          data-print-doc
          // 흰 종이는 용지 전체 폭이고, 여백은 그 안쪽 흰 자리로 그린다. 그래야
          // 여백을 키워도 종이가 줄어드는 것처럼 보이지 않고, 화면과 인쇄가 같은
          // 그림이 된다.
          style={
            {
              // 폭은 인라인이 아니라 변수로 넘긴다. 인쇄에서는 위 규칙이 이
              // 값을 버리고 인쇄 영역을 그대로 쓴다 — 인라인이면 못 버린다.
              '--print-sheet-width': `${paperWidth}mm`,
              '--print-pad-x': `${margin}mm`,
              '--print-pad-y': `${Math.max(12, margin)}mm`,
              '--print-scale': scale,
              '--print-leading': leading,
              // 단위가 없는 숫자를 calc()로 조합하면 인쇄 미리보기 엔진에 따라
              // 선언 전체가 무효가 될 수 있다. 완성된 백분율 값을 넘긴다.
              '--print-image-width': `${imageWidth}%`,
            } as CSSProperties
          }
          className={cn(
            'print-sheet mx-auto bg-white text-slate-900 shadow-sm print:shadow-none',
            !printReady && 'print:hidden',
          )}
        >
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
              {effectiveLayout !== 'stack' ? `, ${LAYOUT_LABEL[effectiveLayout]}` : ''}
              {columns > 1 ? `, ${columns}단` : ''}
            </p>
            {source === 'exam' && exam?.overview && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{exam.overview}</p>
            )}
          </header>

          {/* 다단에서는 문항 간격을 CSS 쪽(print-columns > li)에서 잡는다.
              space-y-* 는 형제에 margin-top 을 주는데, 단 맨 위에 남은 여백이
              단마다 시작 높이를 어긋나게 한다. */}
          <ol
            className={cn(
              columns > 1
                ? cn(
                    'print-columns',
                    onePerColumn && 'print-one-per-column',
                    columnRule && 'print-column-rule',
                  )
                : effectiveLayout === 'separate'
                  ? 'space-y-6'
                  : 'space-y-8',
            )}
            style={columns > 1 ? { columnCount: columns } : undefined}
          >
            {questions.map((question, position) => {
              const answer = loaded.answers.get(question.id) ?? null

              return (
                <li key={question.id} className={cn(columns === 1 && 'break-inside-avoid')}>
                  {renderMeta(question)}
                  <div className="flex gap-2">
                    <span className="shrink-0 text-base font-bold">{position + 1}.</span>
                    <div className="min-w-0 flex-1">
                      {/* 분리형은 앞쪽에 문제만 싣고 정답·풀이를 뒤로 몰아 둔다.
                          좌우형은 같은 줄에서 왼쪽 문제 / 오른쪽 풀이로 가른다. */}
                      {effectiveLayout === 'separate' ? (
                        renderQuestion(question, answer, false)
                      ) : effectiveLayout === 'split' ? (
                        <div
                          className="grid items-start"
                          style={{
                            gridTemplateColumns: `minmax(0, ${splitRatio}fr) 1rem minmax(0, ${100 - splitRatio}fr)`,
                          }}
                        >
                          <div className="min-w-0">{renderQuestion(question, answer, withAnswer)}</div>
                          <SplitHandle ratio={splitRatio} onRatio={setSplitRatio} />
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

          {effectiveLayout === 'separate' && (withAnswer || onCount > 0) && (
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

/**
 * 좌우 분할에서 문제와 풀이 사이의 바.
 *
 * 끌면 모든 문항의 비율이 함께 바뀐다. 문항마다 따로 잡으면 쪽마다 글 폭이
 * 달라져 읽기 어렵다. 인쇄에는 바를 빼고 가운데 칸만 여백으로 남는다.
 */
function SplitHandle({ ratio, onRatio }: { ratio: number; onRatio: (next: number) => void }) {
  function clamp(next: number) {
    return Math.min(80, Math.max(20, Math.round(next)))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="문제와 풀이 폭 조절"
      aria-valuenow={ratio}
      aria-valuemin={20}
      aria-valuemax={80}
      tabIndex={0}
      title="끌어서 문제와 풀이 폭 조절"
      onPointerDown={(event) => {
        const grid = event.currentTarget.parentElement
        if (!grid) return
        const rect = grid.getBoundingClientRect()
        if (rect.width === 0) return
        event.preventDefault()
        const move = (moved: PointerEvent) => {
          onRatio(clamp(((moved.clientX - rect.left) / rect.width) * 100))
        }
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onRatio(clamp(ratio - 2))
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          onRatio(clamp(ratio + 2))
        }
      }}
      className="print-hide group relative cursor-col-resize self-stretch focus:outline-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300 transition-colors group-hover:bg-brand-500 group-focus:bg-brand-500" />
    </div>
  )
}
