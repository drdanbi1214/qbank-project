import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'
import { QuestionForm } from '@/components/admin/QuestionForm'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import {
  fetchAdminQuestions,
  fetchQuestionForEdit,
  type AdminQuestionRow,
  type QuestionDraft,
} from '@/lib/queries/admin'
import { getSignedUrl } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import { cn } from '@/utils/cn'

/**
 * PDF 검수 화면.
 *
 * 왼쪽에 원본 PDF, 오른쪽에 입력 폼을 놓고 나란히 보며 옮겨 적는다.
 * 데이터 입력 생산성이 여기서 갈리므로 화면 전환 없이 한 자리에서 끝나게 한다.
 *
 * PDF 는 브라우저 기본 뷰어에 맡긴다. pdf.js 를 넣으면 번들이 크게 늘고,
 * 확대와 검색 같은 기능은 기본 뷰어가 이미 잘 한다.
 */
export function AdminReviewPage() {
  const [params, setParams] = useSearchParams()
  const { session } = useAuth()
  const { taxonomy, refreshAll } = useData()
  const userId = session?.user.id ?? ''

  const examId = params.get('exam')
  const currentId = params.get('q')

  const [rows, setRows] = useState<AdminQuestionRow[] | null>(null)
  const [draft, setDraft] = useState<{ key: string; value: QuestionDraft | null } | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  /** 사용자가 직접 넘긴 쪽. 어느 문항에서 넘겼는지 함께 들고 있는다. */
  const [manualPage, setManualPage] = useState<{ questionId: string; page: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // 문항 목록
  useEffect(() => {
    if (!examId) return
    let active = true
    void fetchAdminQuestions({ examId })
      .then((next) => {
        if (active) setRows(next)
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '문항을 불러오지 못했습니다.')
      })
    return () => {
      active = false
    }
  }, [examId, reloadKey])

  // 원본 PDF 서명 URL
  useEffect(() => {
    if (!examId) return
    let active = true

    async function load() {
      const { data, error: queryError } = await supabase
        .from('exams')
        .select('source_file_url')
        .eq('id', examId ?? '')
        .maybeSingle()

      if (queryError || !data?.source_file_url) {
        if (active) setPdfUrl(null)
        return
      }
      const signed = await getSignedUrl(data.source_file_url)
      if (active) setPdfUrl(signed)
    }

    void load()
    return () => {
      active = false
    }
  }, [examId])

  // 선택한 문항의 전체 행
  useEffect(() => {
    if (!currentId) return
    let active = true
    void fetchQuestionForEdit(currentId)
      .then((found) => {
        if (active) setDraft({ key: currentId, value: found })
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '문항을 불러오지 못했습니다.')
        setDraft({ key: currentId, value: null })
      })
    return () => {
      active = false
    }
  }, [currentId])

  const select = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params)
      if (id) next.set('q', id)
      else next.delete('q')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const examLabelOf = useCallback(
    (id: string) => {
      const exam = taxonomy?.examById.get(id)
      return examShortLabel(exam, exam ? taxonomy?.subjectById.get(exam.subjectId)?.name : undefined)
    },
    [taxonomy],
  )

  const activeDraft = draft?.key === currentId ? draft.value : null
  const index = rows?.findIndex((row) => row.id === currentId) ?? -1

  /**
   * 문항을 열면 원본의 해당 쪽을 짚어준다.
   * 추출된 이미지 파일명에 `_p3_` 처럼 페이지 번호가 들어 있어 그대로 쓴다.
   * 효과로 상태를 맞추지 않고 파생시켜, 문항을 옮기면 자동으로 다시 계산된다.
   */
  const hintedPage = useMemo(() => {
    for (const block of activeDraft?.stemBlocks ?? []) {
      if (block.type !== 'image') continue
      const match = /_p(\d+)_/.exec(block.url)
      if (match) return Number(match[1])
    }
    return null
  }, [activeDraft])

  const page =
    manualPage && manualPage.questionId === (currentId ?? '')
      ? manualPage.page
      : (hintedPage ?? 1)

  const goToPage = useCallback(
    (next: number) => setManualPage({ questionId: currentId ?? '', page: Math.max(1, next) }),
    [currentId],
  )

  if (!examId) {
    return (
      <DesktopOnly>
        <section>
          <h1 className="mb-4 text-xl font-bold">PDF 검수</h1>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            검수할 시험을 고르세요. 원본 PDF 가 등록된 시험만 나란히 보며 입력할 수 있습니다.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(taxonomy?.exams ?? []).map((exam) => (
              <li key={exam.id}>
                <button
                  type="button"
                  onClick={() => setParams({ exam: exam.id })}
                  className="block w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="font-medium">{examLabelOf(exam.id)}</span>
                  <span className="ml-2 text-sm text-slate-500">{exam.examName}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </DesktopOnly>
    )
  }

  return (
    <DesktopOnly>
      <section className="-mx-4 -my-2">
        <header className="mb-2 flex flex-wrap items-center gap-2 px-4">
          <h1 className="text-lg font-bold">PDF 검수</h1>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {examLabelOf(examId)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setParams({})}>
            다른 시험
          </Button>

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={index <= 0}
              onClick={() => rows && select(rows[index - 1].id)}
            >
              이전 문항
            </Button>
            <span className="px-1 text-sm tabular-nums text-slate-500">
              {index >= 0 ? index + 1 : '-'} / {rows?.length ?? 0}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!rows || index < 0 || index >= rows.length - 1}
              onClick={() => rows && select(rows[index + 1].id)}
            >
              다음 문항
            </Button>
          </div>
        </header>

        {error && (
          <p className="mx-4 mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="grid gap-2 px-4 xl:grid-cols-[1fr_1fr]">
          {/* 왼쪽: 원본 PDF */}
          <div className="flex h-[calc(100dvh-9rem)] flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-1.5 dark:border-slate-700">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">원본</span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => goToPage(page - 1)}>
                  이전 쪽
                </Button>
                <input
                  type="number"
                  min={1}
                  value={page}
                  onChange={(event) => goToPage(Number(event.target.value) || 1)}
                  className="h-7 w-14 rounded border border-slate-300 px-1 text-center text-sm dark:border-slate-600 dark:bg-slate-950"
                />
                <Button size="sm" variant="ghost" onClick={() => goToPage(page + 1)}>
                  다음 쪽
                </Button>
              </div>
            </div>

            {pdfUrl ? (
              <iframe
                // 페이지가 바뀌면 주소 조각도 바뀌어야 뷰어가 이동한다.
                key={`${pdfUrl}#${page}`}
                src={`${pdfUrl}#page=${page}&view=FitH`}
                title="원본 PDF"
                className="min-h-0 flex-1 rounded-b-xl"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-6 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  이 시험에는 원본 PDF 가 등록되어 있지 않습니다.
                </p>
              </div>
            )}
          </div>

          {/* 오른쪽: 입력 폼 */}
          <div className="flex h-[calc(100dvh-9rem)] flex-col rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
            {rows === null ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="h-6 w-6" />
              </div>
            ) : !currentId ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
                  검수할 문항을 고르세요.
                </p>
                <ol className="grid grid-cols-8 gap-1">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => select(row.id)}
                        className={cn(
                          'grid aspect-square w-full place-items-center rounded-lg border text-sm transition-colors',
                          row.completeness === 'complete' && row.status === 'published'
                            ? 'border-slate-200 bg-white text-slate-600 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900'
                            : 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
                        )}
                      >
                        {row.questionNumber}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : activeDraft === null ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="h-6 w-6" />
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-bold">{activeDraft.questionNumber}번 검수</h2>
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => select(null)}>
                    목록으로
                  </Button>
                </div>

                <QuestionForm
                  key={currentId}
                  draft={activeDraft}
                  userId={userId}
                  compact
                  onSaved={() => {
                    setReloadKey((value) => value + 1)
                    refreshAll()
                    // 저장하면 곧바로 다음 문항으로 넘어가 흐름이 끊기지 않게 한다.
                    if (rows && index >= 0 && index < rows.length - 1) select(rows[index + 1].id)
                    else select(null)
                  }}
                  onCancel={() => select(null)}
                />
              </div>
            )}
          </div>
        </div>
      </section>
    </DesktopOnly>
  )
}
