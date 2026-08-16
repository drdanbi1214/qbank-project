import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { QuestionView } from '@/components/question/QuestionView'
import { Spinner } from '@/components/ui/Spinner'
import {
  fetchBookmarked,
  fetchQuestionById,
  fetchQuestionSet,
  fetchQuestions,
  type QuestionSet,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { fetchSession, startSession, updateSessionOrder, updateSessionProgress } from '@/lib/queries/study'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'

/**
 * 풀이 세션. 범위는 쿼리 스트링으로 받는다.
 *   /solve?unit=<id>            단원
 *   /solve?exam=<id>            시험
 *   /solve?subject=<id>         과목 전체
 *   /solve?subject=<id>&unlabeled=1  해당 과목의 미분류 문제
 *   /solve?question=<id>        단건
 *   /solve?session=<id>         저장된 학습 세션 (이어풀기, 오답 재풀이, 북마크 재풀이)
 * 현재 위치는 &i=<index> 로 URL 에 남겨 새로고침과 뒤로가기에서 유지된다.
 */
export function SolvePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { taxonomy, refreshProgress } = useData()
  const { session: authSession } = useAuth()
  const userId = authSession?.user.id ?? ''

  const unitId = params.get('unit')
  const examId = params.get('exam')
  const subjectId = params.get('subject')
  const questionId = params.get('question')
  const sessionId = params.get('session')
  const unlabeled = params.get('unlabeled') === '1'
  // 배정 화면에서 넘어온 경우 정답을 바로 열고 풀이 작성창까지 펼친다.
  const autoReveal = params.get('reveal') === '1'
  const autoWrite = params.get('write') === '1'

  // 요청 키를 결과에 함께 저장해 로딩 상태를 파생시킨다.
  const requestKey = `${unitId ?? ''}|${examId ?? ''}|${subjectId ?? ''}|${questionId ?? ''}|${sessionId ?? ''}|${unlabeled}`

  const [loaded, setLoaded] = useState<{
    key: string
    questions: SolveQuestion[]
    /** 세션으로 들어온 경우 이어서 볼 위치 */
    startIndex: number
  } | null>(null)
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null)
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set())
  const [setCache, setSetCache] = useState<{ id: string; value: QuestionSet | null } | null>(null)
  /** 범위 진입으로 새로 만든 세션. 진행 위치를 여기에 기록한다. */
  const trackedSession = useRef<string | null>(null)

  const questions = loaded?.key === requestKey ? loaded.questions : []
  const error = failed?.key === requestKey ? failed.message : null
  const loading = loaded?.key !== requestKey && error === null

  useEffect(() => {
    let active = true

    async function load() {
      try {
        // 세션은 문제 목록과 순서가 이미 정해져 있다.
        if (sessionId) {
          const found = await fetchSession(sessionId)
          if (!found) throw new Error('세션을 찾을 수 없습니다.')

          const fetched = await Promise.all(found.questionIds.map((id) => fetchQuestionById(id)))
          const ordered = fetched.filter((row): row is SolveQuestion => row !== null)
          const marked = await fetchBookmarked(ordered.map((row) => row.id))
          if (!active) return
          setLoaded({ key: requestKey, questions: ordered, startIndex: found.currentIndex })
          setBookmarks(marked)
          return
        }

        // 단건 진입은 그 문제만 바로 받는다. 예전에는 범위 전체를 받아
        // 거기서 걸렀는데, 문제가 쌓이면서 PostgREST 반환 상한(기본 1000행)에
        // 걸려 뒤쪽 문제는 목록에 아예 오지 않았다. 그래서 배정 화면에서
        // 넘어오면 '이 범위에 풀 문제가 없습니다' 가 떴다.
        const finalRows = questionId
          ? await fetchQuestionById(questionId).then((one) => (one ? [one] : []))
          : await fetchQuestions({
              unitId: unitId ?? undefined,
              examId: examId ?? undefined,
              subjectId: subjectId ?? undefined,
              unlabeledOnly: unlabeled,
            })

        const marked = await fetchBookmarked(finalRows.map((row) => row.id))
        if (!active) return
        setLoaded({ key: requestKey, questions: finalRows, startIndex: 0 })
        setBookmarks(marked)

        // 여러 문제를 순서대로 푸는 진입이면 이어풀기용 세션을 남긴다.
        // 단건 보기는 세션을 만들지 않는다. 진행 중이던 다른 세션을 밀어내기 때문이다.
        if (!questionId && userId && finalRows.length > 1) {
          const created = await startSession({
            userId,
            mode: 'sequential',
            scope: { unit_id: unitId, exam_id: examId, subject_id: subjectId },
            questionIds: finalRows.map((row) => row.id),
          })
          if (active) trackedSession.current = created
        }
      } catch (caught) {
        if (!active) return
        setFailed({
          key: requestKey,
          message: caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.',
        })
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [unitId, examId, subjectId, questionId, sessionId, unlabeled, requestKey, userId])

  // 세션으로 들어왔고 URL 에 위치가 없으면 저장된 위치에서 이어간다.
  const savedIndex = loaded?.key === requestKey ? loaded.startIndex : 0
  const urlIndex = params.get('i')
  const index = urlIndex !== null ? Math.max(0, Number(urlIndex) || 0) : savedIndex

  const current = questions[Math.min(index, Math.max(0, questions.length - 1))] ?? null

  // R형이면 공통 선지를 가져온다. 캐시 키가 현재 문제의 세트와 맞을 때만 사용한다.
  const questionSet =
    current?.setId && setCache?.id === current.setId ? setCache.value : null

  useEffect(() => {
    const setId = current?.setId
    if (!setId) return
    let active = true
    void fetchQuestionSet(setId)
      .then((next) => {
        if (active) setSetCache({ id: setId, value: next })
      })
      .catch((caught: unknown) => console.error('세트를 불러오지 못했습니다.', caught))
    return () => {
      active = false
    }
  }, [current?.setId])

  const goTo = useCallback(
    (nextIndex: number) => {
      const next = new URLSearchParams(params)
      next.set('i', String(nextIndex))
      setParams(next, { replace: false })
      window.scrollTo({ top: 0 })
      // 이어풀기를 위해 진행 위치를 남긴다.
      const tracking = sessionId ?? trackedSession.current
      if (tracking) void updateSessionProgress(tracking, nextIndex)
    },
    [params, setParams, sessionId],
  )

  /** 남은 문제 순서를 무작위로 섞고 처음 문제로 되돌아간다. */
  const shuffle = useCallback(() => {
    if (loaded?.key !== requestKey || loaded.questions.length < 2) return
    const shuffled = [...loaded.questions]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    setLoaded({ key: requestKey, questions: shuffled, startIndex: 0 })

    const next = new URLSearchParams(params)
    next.set('i', '0')
    setParams(next, { replace: false })
    window.scrollTo({ top: 0 })

    // 새로고침해도 섞인 순서가 유지되도록 세션에도 반영한다.
    const tracking = sessionId ?? trackedSession.current
    if (tracking) void updateSessionOrder(tracking, shuffled.map((row) => row.id))
  }, [loaded, requestKey, params, setParams, sessionId])

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const subjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, subjectName)
    },
    [taxonomy],
  )

  const exitTo = useMemo(() => {
    if (sessionId) return '/wrong-notes'
    if (unitId && taxonomy) {
      const unit = taxonomy.unitById.get(unitId)
      return unit ? `/study/${unit.subjectId}/${unit.id}` : '/study'
    }
    if (examId) return `/exams/${examId}`
    if (subjectId) return `/study/${subjectId}`
    return '/study'
  }, [sessionId, unitId, examId, subjectId, taxonomy])

  const handleAnswered = useCallback(() => {
    refreshProgress()
  }, [refreshProgress])

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950">
      <Header />

      <main className="mx-auto max-w-3xl px-3 pt-4 sm:px-4">
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner className="h-7 w-7" />
          </div>
        ) : error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        ) : !current ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              이 범위에 풀 문제가 없습니다.
            </p>
          </div>
        ) : (
          <QuestionView
            key={current.id}
            question={current}
            questionSet={questionSet}
            unitName={current.unitId ? (taxonomy?.unitById.get(current.unitId)?.name ?? null) : null}
            examLabel={examLabelOf(current.examId)}
            examLabelOf={examLabelOf}
            position={{ index: index + 1, total: questions.length }}
            bookmarked={bookmarks.has(current.id)}
            onBookmarkChange={(next) =>
              setBookmarks((prev) => {
                const copy = new Set(prev)
                if (next) copy.add(current.id)
                else copy.delete(current.id)
                return copy
              })
            }
            onPrev={index > 0 ? () => goTo(index - 1) : undefined}
            onNext={index < questions.length - 1 ? () => goTo(index + 1) : undefined}
            onShuffle={questions.length > 1 ? shuffle : undefined}
            onJumpTo={questions.length > 1 ? goTo : undefined}
            autoReveal={autoReveal}
            autoWrite={autoWrite}
            onExit={() => navigate(exitTo)}
            onAnswered={handleAnswered}
          />
        )}
      </main>
    </div>
  )
}
