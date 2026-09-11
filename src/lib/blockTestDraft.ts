export type BlockGrade = { selected: number[]; isCorrect: boolean | null }
export type BlockTestDraft = {
  version: 1
  sessionId: string
  questionIds: string[]
  startedAt: number
  deadline: number | null
  submittedAt: number | null
  phase: 'running' | 'result'
  index: number
  answers: Record<string, number[]>
  grades: Record<string, BlockGrade>
}

export function blockDraftKey(userId: string, examId: string) {
  return `qbank:block-test:v1:${userId}:${examId}`
}

export function remainingSeconds(deadline: number | null, now: number): number | null {
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000))
}

const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const choices = (value: unknown): value is number[] => Array.isArray(value) && value.every((n) => Number.isInteger(n) && n > 0)

/** A damaged or old draft must never crash the study screen. */
export function parseBlockDraft(raw: string | null): BlockTestDraft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as BlockTestDraft
    if (!d || d.version !== 1 || typeof d.sessionId !== 'string' || !d.sessionId ||
      !Array.isArray(d.questionIds) || !d.questionIds.length || !d.questionIds.every((id) => typeof id === 'string') ||
      !finiteNumber(d.startedAt) || (d.deadline !== null && !finiteNumber(d.deadline)) ||
      (d.submittedAt !== null && !finiteNumber(d.submittedAt)) ||
      !['running', 'result'].includes(d.phase) || !Number.isInteger(d.index) || d.index < 0 || d.index >= d.questionIds.length ||
      !d.answers || !Object.values(d.answers).every(choices) || !d.grades ||
      !Object.values(d.grades).every((g) => g && choices(g.selected) && (g.isCorrect === null || typeof g.isCorrect === 'boolean')) ||
      (d.phase === 'result' && (d.submittedAt === null || !d.questionIds.every((id) => d.grades[id])))) return null
    return d
  } catch { return null }
}
