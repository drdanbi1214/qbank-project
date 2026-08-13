import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { RichTextViewer } from '@/components/editor/RichTextViewer'
import { StemBlocks } from '@/components/question/StemBlocks'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { useAuth } from '@/lib/auth'
import {
  fetchQuestionsByIds,
  revealAnswers,
  type SolveQuestion,
} from '@/lib/queries/questions'
import { fetchSolutionsForQuestions, type Solution } from '@/lib/queries/solutions'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { fetchBookmarkedQuestions, fetchWrongNotes } from '@/lib/queries/study'
import { circled, formatAnswer, type AnswerPayload } from '@/types/question'
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
type Loaded = {
  key: string
  questions: SolveQuestion[]
  answers: Map<string, AnswerPayload>
  solutions: Map<string, Solution[]>
}

export function PrintPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { taxonomy } = useData()
  const { hasPermission } = useAuth()
  const canViewStudySolutions = hasPermission('study_hapbon3')

  const source = params.get('source') === 'bookmark' ? 'bookmark' : 'wrong'
  const subjectId = params.get('subject')
  const unitId = params.get('unit')
  const examId = params.get('exam')
  const cohort = params.get('cohort')

  const [withAnswer, setWithAnswer] = useState(params.get('answer') !== '0')
  const [withSolution, setWithSolution] = useState(
    canViewStudySolutions && params.get('solution') !== '0',
  )

  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requestKey = [source, subjectId ?? '', unitId ?? '', examId ?? '', cohort ?? ''].join('|')

  useEffect(() => {
    let active = true

    async function load() {
      try {
        const ids =
          source === 'bookmark'
            ? (await fetchBookmarkedQuestions()).map((row) => row.questionId)
            : (await fetchWrongNotes({ subjectId, unitId, examId, cohort })).map(
                (row) => row.questionId,
              )

        const questions = await fetchQuestionsByIds(ids)
        const [answers, solutions] = await Promise.all([
          revealAnswers(questions.map((row) => row.id)),
          canViewStudySolutions
            ? fetchSolutionsForQuestions(
                questions.map((row) => ({ questionId: row.id, groupId: row.groupId })),
              )
            : Promise.resolve(new Map<string, Solution[]>()),
        ])

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
  }, [source, subjectId, unitId, examId, cohort, requestKey, canViewStudySolutions])

  const examLabelOf = useMemo(() => {
    return (id: string) => {
      const exam = taxonomy?.examById.get(id)
      const subjectName = exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined
      return examShortLabel(exam, subjectName)
    }
  }, [taxonomy])

  const ready = loaded?.key === requestKey
  const questions = ready ? loaded.questions : []

  const title = source === 'bookmark' ? '북마크 문제집' : '오답 문제집'

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0 dark:bg-slate-950">
      {/* 인쇄물에는 나가지 않는 설정 막대 */}
      <div className="mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center gap-3 px-4 print:hidden">
        <Button variant="secondary" onClick={() => navigate(-1)}>
          돌아가기
        </Button>

        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={withAnswer}
            onChange={(event) => setWithAnswer(event.target.checked)}
          />
          정답 포함
        </label>
        {canViewStudySolutions && (
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={withSolution}
              onChange={(event) => setWithSolution(event.target.checked)}
            />
            풀이 포함
          </label>
        )}

        <Button className="ml-auto" onClick={() => window.print()} disabled={!ready}>
          인쇄 또는 PDF 저장
        </Button>
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
              {withAnswer ? ', 정답 포함' : ''}
              {withSolution ? ', 풀이 포함' : ''}
            </p>
          </header>

          <ol className="space-y-8">
            {questions.map((question, position) => {
              const answer = loaded.answers.get(question.id) ?? null
              const solutions = loaded.solutions.get(question.id) ?? []

              return (
                <li
                  key={question.id}
                  // 한 문항이 페이지 경계에서 잘리지 않게 한다.
                  className="break-inside-avoid"
                >
                  <div className="mb-1 text-xs text-slate-500">
                    {examLabelOf(question.examId)} {question.questionNumber}번
                    {question.unitId
                      ? ` / ${taxonomy?.unitById.get(question.unitId)?.name ?? '미분류'}`
                      : ''}
                  </div>

                  <div className="flex gap-2">
                    <span className="shrink-0 text-base font-bold">{position + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <StemBlocks blocks={question.stemBlocks} />

                      {question.choices.length > 0 && (
                        <ol className="mt-2 space-y-1">
                          {question.choices.map((choice) => {
                            const isAnswer =
                              withAnswer && (answer?.editorAnswer.includes(choice.no) ?? false)
                            return (
                              <li
                                key={choice.no}
                                className={cn(
                                  'flex gap-2 text-[15px] leading-6',
                                  isAnswer && 'font-bold',
                                )}
                              >
                                <span className="shrink-0">{circled(choice.no)}</span>
                                <span>{choice.text ?? '(이미지 보기)'}</span>
                              </li>
                            )
                          })}
                        </ol>
                      )}

                      {withAnswer && answer && (
                        <div className="mt-2 border-l-4 border-slate-800 bg-slate-50 py-1.5 pl-3 text-sm">
                          <p>
                            <span className="font-bold">정답</span>{' '}
                            {answer.editorAnswer.length > 0
                              ? formatAnswer(answer.editorAnswer)
                              : '미확정'}
                            {answer.yamaAnswer &&
                              answer.yamaAnswer.length > 0 &&
                              answer.editorAnswer.join() !== answer.yamaAnswer.join() && (
                                <span className="ml-2 text-slate-500">
                                  야마답 {formatAnswer(answer.yamaAnswer)}
                                </span>
                              )}
                          </p>
                          {answer.answerNote && (
                            <p className="mt-0.5 text-slate-600">{answer.answerNote}</p>
                          )}
                          {answer.modelAnswer && (
                            <p className="mt-0.5 whitespace-pre-wrap text-slate-600">
                              {answer.modelAnswer}
                            </p>
                          )}
                        </div>
                      )}

                      {withAnswer &&
                        answer?.officialExplanation &&
                        answer.officialExplanation.length > 0 && (
                          <div className="mt-2 text-sm">
                            <p className="font-semibold">원본 해설</p>
                            <StemBlocks blocks={answer.officialExplanation} />
                          </div>
                        )}

                      {withSolution &&
                        solutions.map((solution) => (
                          <div key={solution.id} className="mt-3 border-t border-slate-200 pt-2">
                            <p className="mb-1 text-xs text-slate-500">
                              풀이 by {solution.author.displayName}
                            </p>
                            <RichTextViewer doc={solution.content} className="solution-rich-text" />
                          </div>
                        ))}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </article>
      )}
    </div>
  )
}
