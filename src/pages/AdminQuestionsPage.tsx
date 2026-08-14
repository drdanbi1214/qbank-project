import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DesktopOnly } from '@/components/DesktopOnly'
import { QuestionForm } from '@/components/admin/QuestionForm'
import { emptyDraft } from '@/components/admin/questionDraft'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/lib/auth'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import {
  deleteQuestion,
  fetchAdminQuestions,
  fetchQuestionForEdit,
  type AdminQuestionRow,
  type QuestionDraft,
} from '@/lib/queries/admin'
import { cn } from '@/utils/cn'

const ANSWER_LABEL: Record<string, string> = {
  confirmed: '확정',
  unconfirmed: '미확정',
  disputed: '이의',
}

const STATUS_LABEL: Record<string, string> = {
  published: '공개',
  draft: '검수 중',
  hidden: '숨김',
}

/** 관리자 문제 관리. 목록에서 고르면 오른쪽에 편집 폼이 열린다. */
export function AdminQuestionsPage() {
  const [params, setParams] = useSearchParams()
  const { session } = useAuth()
  const { taxonomy, refreshAll } = useData()
  const userId = session?.user.id ?? ''

  const examId = params.get('exam')
  const subjectId = params.get('subject')
  const flag = params.get('flag')
  const search = params.get('q') ?? ''
  const editingId = params.get('edit')

  const [input, setInput] = useState(search)
  const [reloadKey, setReloadKey] = useState(0)
  const [formVersion, setFormVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<{ key: string; rows: AdminQuestionRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 편집 대상과 함께 저장해 로딩 여부를 파생시킨다. 효과 안에서 상태를 미리 바꾸지 않는다.
  const [draft, setDraft] = useState<{ key: string; value: QuestionDraft | null } | null>(null)

  const requestKey = [examId ?? '', subjectId ?? '', flag ?? '', search, reloadKey].join('|')

  useEffect(() => {
    let active = true
    void fetchAdminQuestions({
      examId,
      subjectId,
      unlabeledOnly: flag === 'unlabeled',
      unconfirmedOnly: flag === 'unconfirmed',
      incompleteOnly: flag === 'incomplete',
      search,
    })
      .then((rows) => {
        if (active) {
          setLoaded({ key: requestKey, rows })
          setError(null)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
        }
      })
    return () => {
      active = false
    }
  }, [examId, subjectId, flag, search, requestKey])

  // 편집 대상이 바뀌면 전체 행을 다시 받는다 (정답 컬럼은 목록에 없다).
  useEffect(() => {
    if (!editingId || editingId === 'new') {
      return
    }
    let active = true
    void fetchQuestionForEdit(editingId)
      .then((found) => {
        if (active) setDraft({ key: editingId, value: found ? { ...found } : null })
      })
      .catch((caught: unknown) => {
        if (!active) return
        setError(caught instanceof Error ? caught.message : '문제를 불러오지 못했습니다.')
        setDraft({ key: editingId, value: null })
      })
    return () => {
      active = false
    }
  }, [editingId])

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
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

  const exams = useMemo(
    () =>
      (taxonomy?.exams ?? []).filter((exam) => !subjectId || exam.subjectId === subjectId),
    [taxonomy, subjectId],
  )

  const ready = loaded?.key === requestKey
  const rows = ready ? loaded.rows : []

  const loadingDraft = Boolean(editingId) && editingId !== 'new' && draft?.key !== editingId
  const activeDraft: QuestionDraft | null =
    editingId === 'new'
      ? (draft?.key === 'new' ? draft.value : null) ?? emptyDraft(examId ?? '')
      : editingId && draft?.key === editingId
        ? draft.value
        : null

  async function remove(id: string) {
    if (!window.confirm('문제를 삭제할까요? 달린 풀이와 기록도 함께 사라집니다.')) return
    try {
      await deleteQuestion(id)
      setReloadKey((value) => value + 1)
      update({ edit: null })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '삭제하지 못했습니다.')
    }
  }

  const selectClass =
    'rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm outline-none dark:border-slate-700 dark:bg-slate-900'

  return (
    <DesktopOnly>
      <section>
        <header className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">문제 관리</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              문제를 등록하고 고칩니다. 수정 내역은 자동으로 이력에 남습니다.
            </p>
          </div>
          <Button
            onClick={() => {
              setDraft({ key: 'new', value: emptyDraft(examId ?? '') })
              setFormVersion((value) => value + 1)
              setNotice(null)
              update({ edit: 'new' })
            }}
          >
            새 문제
          </Button>
        </header>

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="grid gap-5 xl:grid-cols-[24rem_1fr]">
          {/* 목록 */}
          <div>
            <div className="mb-2 flex flex-wrap gap-1">
              <select
                value={subjectId ?? ''}
                onChange={(event) => update({ subject: event.target.value || null, exam: null })}
                className={selectClass}
                aria-label="과목"
              >
                <option value="">과목 전체</option>
                {(taxonomy?.subjects ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>

              <select
                value={examId ?? ''}
                onChange={(event) => update({ exam: event.target.value || null })}
                className={selectClass}
                aria-label="시험"
              >
                <option value="">시험 전체</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {examLabelOf(exam.id)}
                  </option>
                ))}
              </select>

              <select
                value={flag ?? ''}
                onChange={(event) => update({ flag: event.target.value || null })}
                className={selectClass}
                aria-label="상태"
              >
                <option value="">전체</option>
                <option value="unlabeled">단원 미분류</option>
                <option value="unconfirmed">정답 미확정</option>
                <option value="incomplete">복기 불완전</option>
              </select>
            </div>

            <form
              className="mb-2 flex gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                update({ q: input.trim() || null })
              }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="본문 검색"
                className={`${selectClass} w-full`}
              />
              <Button size="sm" type="submit">
                찾기
              </Button>
            </form>

            {!ready ? (
              <div className="flex justify-center py-10">
                <Spinner className="h-6 w-6" />
              </div>
            ) : rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                조건에 맞는 문제가 없습니다.
              </p>
            ) : (
              <>
                <p className="mb-1 text-xs text-slate-400">{rows.length}문항</p>
                <ul className="max-h-[calc(100dvh-18rem)] divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setNotice(null)
                          update({ edit: row.id })
                        }}
                        className={cn(
                          'block w-full px-3 py-2 text-left transition-colors',
                          editingId === row.id
                            ? 'bg-brand-50 dark:bg-brand-900/30'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50',
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1 text-xs">
                          <span className="font-semibold text-brand-600 dark:text-brand-300">
                            {examLabelOf(row.examId)} {row.questionNumber}번
                          </span>
                          {row.questionCode && (
                            <Tag tone="muted">{`코드 ${row.questionCode}`}</Tag>
                          )}
                          {row.unitId === null && <Tag tone="warn">미분류</Tag>}
                          {row.answerStatus !== 'confirmed' && (
                            <Tag tone="warn">{ANSWER_LABEL[row.answerStatus]}</Tag>
                          )}
                          {row.completeness !== 'complete' && <Tag tone="warn">불완전</Tag>}
                          {row.status !== 'published' && (
                            <Tag tone="muted">{STATUS_LABEL[row.status] ?? row.status}</Tag>
                          )}
                          {row.groupId && <Tag tone="muted">그룹</Tag>}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                          {row.stemText ?? '본문 없음'}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* 편집 */}
          <div>
            {loadingDraft ? (
              <div className="flex justify-center py-16">
                <Spinner className="h-7 w-7" />
              </div>
            ) : activeDraft ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-bold">
                    {editingId === 'new' ? '새 문제 등록' : '문제 수정'}
                  </h2>
                  {editingId !== 'new' && editingId && (
                    <Button size="sm" variant="danger" onClick={() => void remove(editingId)}>
                      삭제
                    </Button>
                  )}
                </div>

                {notice && editingId === 'new' && (
                  <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {notice}
                  </p>
                )}

                <QuestionForm
                  key={`${editingId}:${formVersion}`}
                  draft={activeDraft}
                  userId={userId}
                  onSaved={(_id, savedDraft) => {
                    setReloadKey((value) => value + 1)
                    refreshAll()
                    if (editingId === 'new') {
                      const next = emptyDraft(savedDraft.examId)
                      next.unitId = savedDraft.unitId
                      next.questionNumber = savedDraft.questionNumber + 1
                      setDraft({ key: 'new', value: next })
                      setFormVersion((value) => value + 1)
                      setNotice(
                        `${savedDraft.questionNumber}번을 등록했습니다. ${next.questionNumber}번을 이어서 입력하세요.`,
                      )
                      return
                    }
                    update({ edit: null })
                    setDraft(null)
                  }}
                  onCancel={() => {
                    update({ edit: null })
                    setDraft(null)
                    setNotice(null)
                  }}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 p-16 dark:border-slate-700">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  왼쪽에서 문제를 고르거나 새 문제를 등록하세요.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </DesktopOnly>
  )
}

function Tag({ tone, children }: { tone: 'warn' | 'muted'; children: string }) {
  return (
    <span
      className={cn(
        'rounded px-1 py-0.5 text-[11px] font-medium',
        tone === 'warn'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
      )}
    >
      {children}
    </span>
  )
}
