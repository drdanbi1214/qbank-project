import { useMemo, useState, type ReactNode } from 'react'
import { StemBlockEditor } from '@/components/admin/StemBlockEditor'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { examShortLabel, questionCodePreview } from '@/lib/queries/taxonomy'
import { saveQuestion, type QuestionDraft } from '@/lib/queries/admin'
import { circled, type Choice } from '@/types/question'
import { cn } from '@/utils/cn'

/**
 * 문제 등록 및 수정 폼.
 *
 * 보기 개수는 고정하지 않는다. 복기 자료에 4개짜리와 6개짜리가 섞여 있어
 * 배열 길이를 그대로 따라간다. 정답도 항상 배열로 다룬다.
 */
type Props = {
  draft: QuestionDraft
  userId: string
  onSaved: (id: string) => void
  onCancel: () => void
  /** PDF 검수 화면처럼 좁은 칸에 넣을 때 여백을 줄인다 */
  compact?: boolean
}

export function QuestionForm({ draft: initial, userId, onSaved, onCancel, compact }: Props) {
  const { taxonomy } = useData()
  const [draft, setDraft] = useState<QuestionDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const units = useMemo(() => {
    const exam = taxonomy?.examById.get(draft.examId)
    if (!exam) return taxonomy?.units ?? []
    return (taxonomy?.units ?? []).filter((unit) => unit.subjectId === exam.subjectId)
  }, [taxonomy, draft.examId])

  const questionCode = useMemo(() => {
    const exam = taxonomy?.examById.get(draft.examId)
    const subject = exam ? taxonomy?.subjectById.get(exam.subjectId) : undefined
    return questionCodePreview(exam, subject, draft.questionNumber)
  }, [taxonomy, draft.examId, draft.questionNumber])

  function patch(next: Partial<QuestionDraft>) {
    setDraft((prev) => ({ ...prev, ...next }))
  }

  function setChoice(no: number, next: Partial<Choice>) {
    patch({
      choices: draft.choices.map((choice) =>
        choice.no === no ? { ...choice, ...next } : choice,
      ),
    })
  }

  function toggleAnswer(no: number, which: 'editor' | 'yama') {
    if (which === 'editor') {
      const has = draft.editorAnswer.includes(no)
      patch({
        editorAnswer: has
          ? draft.editorAnswer.filter((value) => value !== no)
          : [...draft.editorAnswer, no].sort((a, b) => a - b),
      })
      return
    }
    const current = draft.yamaAnswer ?? []
    const has = current.includes(no)
    const next = has
      ? current.filter((value) => value !== no)
      : [...current, no].sort((a, b) => a - b)
    patch({ yamaAnswer: next.length === 0 ? null : next })
  }

  async function save() {
    if (!draft.examId) {
      setError('시험을 선택해주세요.')
      return
    }
    if (draft.questionType !== 'essay' && draft.choices.length < 2) {
      setError('보기를 2개 이상 넣어주세요.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      // 정답 개수는 편집자답 길이와 맞춰둔다. 화면에서 라디오와 체크박스를 가르는 기준이다.
      const answerCount = Math.max(1, draft.editorAnswer.length || draft.answerCount)
      const id = await saveQuestion({ ...draft, answerCount })
      onSaved(id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950'

  return (
    <div className={cn('space-y-5', compact && 'space-y-4 text-sm')}>
      {/* 소속 */}
      <section className="grid gap-2 sm:grid-cols-2">
        <Field label="시험">
          <select
            value={draft.examId}
            onChange={(event) => patch({ examId: event.target.value, unitId: null })}
            className={inputClass}
          >
            <option value="">선택</option>
            {(taxonomy?.exams ?? []).map((exam) => (
              <option key={exam.id} value={exam.id}>
                {examShortLabel(exam, taxonomy?.subjectById.get(exam.subjectId)?.name)}{' '}
                {exam.examName}
              </option>
            ))}
          </select>
        </Field>

        <Field label="단원">
          <select
            value={draft.unitId ?? ''}
            onChange={(event) => patch({ unitId: event.target.value || null })}
            className={inputClass}
          >
            <option value="">미분류</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="문항 번호">
          <input
            type="number"
            min={1}
            value={draft.questionNumber}
            onChange={(event) => patch({ questionNumber: Number(event.target.value) || 1 })}
            className={inputClass}
          />
        </Field>

        <Field label="유형">
          <select
            value={draft.questionType}
            onChange={(event) =>
              patch({ questionType: event.target.value as QuestionDraft['questionType'] })
            }
            className={inputClass}
          >
            <option value="A">A형 (단일 문항)</option>
            <option value="R">R형 (공통 선지)</option>
            <option value="essay">서술형</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="7자리 문제 코드 (자동 라벨링)">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <span className="font-mono text-sm font-bold tracking-wider text-brand-700 dark:text-brand-300">
                {questionCode ?? '시험과 문항 번호를 선택해주세요'}
              </span>
              {questionCode && (
                <span className="ml-auto text-xs text-slate-400">저장 시 자동 부여</span>
              )}
            </div>
          </Field>
        </div>
      </section>

      <StemBlockEditor
        blocks={draft.stemBlocks}
        onChange={(next) => patch({ stemBlocks: next })}
        userId={userId}
      />

      {/* 보기와 정답 */}
      {draft.questionType !== 'essay' && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-bold">보기와 정답</h3>
            <span className="text-xs text-slate-400">
              편집자답 기준으로 채점합니다. 야마답은 참고용입니다.
            </span>
          </div>

          <div className="space-y-1">
            {draft.choices.map((choice) => (
              <div key={choice.no} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-base font-semibold text-slate-400">
                  {circled(choice.no)}
                </span>
                <input
                  value={choice.text ?? ''}
                  onChange={(event) => setChoice(choice.no, { text: event.target.value })}
                  placeholder={`보기 ${choice.no}`}
                  className={inputClass}
                />
                <AnswerToggle
                  active={draft.editorAnswer.includes(choice.no)}
                  tone="editor"
                  onClick={() => toggleAnswer(choice.no, 'editor')}
                >
                  편집자답
                </AnswerToggle>
                <AnswerToggle
                  active={(draft.yamaAnswer ?? []).includes(choice.no)}
                  tone="yama"
                  onClick={() => toggleAnswer(choice.no, 'yama')}
                >
                  Y답
                </AnswerToggle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    patch({
                      choices: draft.choices
                        .filter((row) => row.no !== choice.no)
                        .map((row, index) => ({ ...row, no: index + 1 })),
                      editorAnswer: [],
                      yamaAnswer: null,
                    })
                  }
                >
                  ✕
                </Button>
              </div>
            ))}
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() =>
              patch({
                choices: [
                  ...draft.choices,
                  { no: draft.choices.length + 1, text: '', imageUrl: null },
                ],
              })
            }
          >
            보기 추가
          </Button>
        </section>
      )}

      {/* 서술형 */}
      {draft.questionType === 'essay' && (
        <section className="space-y-2">
          <Field label="모범답안">
            <textarea
              value={draft.modelAnswer ?? ''}
              onChange={(event) => patch({ modelAnswer: event.target.value || null })}
              rows={4}
              className={inputClass}
            />
          </Field>
          <Field label="채점 포인트 (줄바꿈으로 구분)">
            <textarea
              value={(draft.gradingPoints ?? []).join('\n')}
              onChange={(event) => {
                const lines = event.target.value.split('\n').filter((line) => line.trim() !== '')
                patch({ gradingPoints: lines.length > 0 ? lines : null })
              }}
              rows={3}
              className={inputClass}
            />
          </Field>
        </section>
      )}

      {/* 정답 상태 */}
      <section className="grid gap-2 sm:grid-cols-2">
        <Field label="정답 상태">
          <select
            value={draft.answerStatus}
            onChange={(event) =>
              patch({ answerStatus: event.target.value as QuestionDraft['answerStatus'] })
            }
            className={inputClass}
          >
            <option value="confirmed">확정</option>
            <option value="unconfirmed">미확정</option>
            <option value="disputed">이의 있음</option>
          </select>
        </Field>

        <Field label="복기 완성도">
          <select
            value={draft.completeness}
            onChange={(event) =>
              patch({ completeness: event.target.value as QuestionDraft['completeness'] })
            }
            className={inputClass}
          >
            <option value="complete">완전</option>
            <option value="partial_choices">보기 일부만</option>
            <option value="partial_stem">본문 일부만</option>
            <option value="image_missing">이미지 누락</option>
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="정답 메모 (야마답과 다를 때 안내 문구)">
            <textarea
              value={draft.answerNote ?? ''}
              onChange={(event) => patch({ answerNote: event.target.value || null })}
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* 부가 정보 */}
      <section className="grid gap-2 sm:grid-cols-2">
        <Field label="교수">
          <input
            value={draft.professor ?? ''}
            onChange={(event) => patch({ professor: event.target.value || null })}
            className={inputClass}
          />
        </Field>
        <Field label="출처 태그 (쉼표로 구분)">
          <input
            value={draft.sourceTags.join(', ')}
            onChange={(event) =>
              patch({
                sourceTags: event.target.value
                  .split(',')
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
            placeholder="21Y, 22Y 변형"
            className={inputClass}
          />
        </Field>
        <Field label="변형 여부">
          <select
            value={draft.variantType}
            onChange={(event) => patch({ variantType: event.target.value })}
            className={inputClass}
          >
            <option value="original">원본</option>
            <option value="identical">동일 (다른 학번에 그대로 재출제)</option>
            <option value="modified">변형</option>
          </select>
        </Field>
        <Field label="공개 상태">
          <select
            value={draft.status}
            onChange={(event) => patch({ status: event.target.value })}
            className={inputClass}
          >
            <option value="published">공개</option>
            <option value="draft">검수 중</option>
            <option value="hidden">숨김</option>
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="복기자 메모">
            <input
              value={draft.restorerNote ?? ''}
              onChange={(event) => patch({ restorerNote: event.target.value || null })}
              placeholder="보기 순서가 다를 수 있음"
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <StemBlockEditor
        blocks={draft.officialExplanation ?? []}
        onChange={(next) => patch({ officialExplanation: next.length > 0 ? next : null })}
        userId={userId}
        label="원본 해설 (선택)"
      />

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 flex gap-2 border-t border-slate-200 bg-slate-50/95 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <Button onClick={() => void save()} disabled={busy}>
          {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
          {draft.id ? '수정 저장' : '등록'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          취소
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  )
}

function AnswerToggle({
  active,
  tone,
  onClick,
  children,
}: {
  active: boolean
  tone: 'editor' | 'yama'
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded px-1.5 py-1 text-xs font-medium transition-colors',
        active
          ? tone === 'editor'
            ? 'bg-brand-600 text-white'
            : 'bg-amber-500 text-white'
          : 'bg-slate-100 text-slate-400 dark:bg-slate-800',
      )}
    >
      {children}
    </button>
  )
}
