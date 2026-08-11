// =============================================================================
// 문제 도메인 타입
// DB 는 jsonb 로 저장하므로 화면에서 쓰기 전에 반드시 파서를 통과시킨다.
// 복기 데이터라 형태가 온전하지 않은 행이 섞일 수 있어, 파싱 실패는 예외 대신
// 해당 항목을 버리는 쪽으로 처리한다.
// =============================================================================

export type StemBlock =
  | { type: 'text'; content: string }
  | { type: 'labbox'; items: { label: string; value: string }[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'image'; url: string; caption: string | null }
  | { type: 'formula'; latex: string }

export type Choice = {
  no: number
  text: string | null
  imageUrl: string | null
}

export type SharedChoice = {
  key: string
  text: string
}

export type AnswerStatus = 'confirmed' | 'unconfirmed' | 'disputed'
export type QuestionType = 'A' | 'R' | 'essay'
export type Completeness = 'complete' | 'partial_choices' | 'partial_stem' | 'image_missing'

/** reveal_answer / submit_attempt 응답에만 들어오는 정답 정보 */
export type AnswerPayload = {
  questionId: string
  editorAnswer: number[]
  yamaAnswer: number[] | null
  answerStatus: AnswerStatus
  answerNote: string | null
  officialExplanation: StemBlock[] | null
  modelAnswer: string | null
  gradingPoints: string[] | null
}

export type QuestionStats = {
  totalAttempts: number
  /** 내 계정의 누적 풀이 횟수 */
  myAttempts: number
  correctCount: number
  /** 0~100, 채점된 시도가 없으면 null */
  correctRate: number | null
  avgTimeSpentSec: number | null
  /** 보기 번호 -> 선택 횟수 */
  choiceDistribution: Record<number, number>
}

export type SubmitResult = {
  attemptId: string
  attemptNumber: number
  isCorrect: boolean | null
  answer: AnswerPayload
  stats: QuestionStats
}

// -----------------------------------------------------------------------------
// 파서
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asString(item) ?? '')
}

export function parseStemBlocks(value: unknown): StemBlock[] {
  if (!Array.isArray(value)) return []

  const blocks: StemBlock[] = []
  for (const raw of value) {
    if (!isRecord(raw)) continue

    switch (raw.type) {
      case 'text': {
        const content = asString(raw.content)
        if (content) blocks.push({ type: 'text', content })
        break
      }
      case 'labbox': {
        const items = Array.isArray(raw.items)
          ? raw.items.filter(isRecord).map((item) => ({
              label: asString(item.label) ?? '',
              value: asString(item.value) ?? '',
            }))
          : []
        if (items.length > 0) blocks.push({ type: 'labbox', items })
        break
      }
      case 'table': {
        const headers = asStringArray(raw.headers)
        const rows = Array.isArray(raw.rows) ? raw.rows.map(asStringArray) : []
        if (headers.length > 0 || rows.length > 0) {
          blocks.push({ type: 'table', headers, rows })
        }
        break
      }
      case 'image': {
        const url = asString(raw.url)
        if (url) blocks.push({ type: 'image', url, caption: asString(raw.caption) })
        break
      }
      case 'formula': {
        const latex = asString(raw.latex)
        if (latex) blocks.push({ type: 'formula', latex })
        break
      }
      default:
        break
    }
  }
  return blocks
}

/**
 * 보기 파싱. 개수는 배열 길이로만 판단하며 5개를 가정하지 않는다.
 * `no` 가 없으면 배열 순서로 번호를 채운다.
 */
export function parseChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((raw, index) => ({
      no: typeof raw.no === 'number' ? raw.no : index + 1,
      text: asString(raw.text),
      imageUrl: asString(raw.image_url),
    }))
    .sort((a, b) => a.no - b.no)
}

export function parseSharedChoices(value: unknown): SharedChoice[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((raw) => ({ key: asString(raw.key) ?? '', text: asString(raw.text) ?? '' }))
    .filter((choice) => choice.key !== '')
}

function parseIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is number => typeof item === 'number')
}

function parseAnswerStatus(value: unknown): AnswerStatus {
  return value === 'confirmed' || value === 'disputed' ? value : 'unconfirmed'
}

export function parseAnswerPayload(value: unknown): AnswerPayload | null {
  if (!isRecord(value)) return null

  const yama = parseIntArray(value.yama_answer)

  return {
    questionId: asString(value.question_id) ?? '',
    editorAnswer: parseIntArray(value.editor_answer),
    yamaAnswer: Array.isArray(value.yama_answer) ? yama : null,
    answerStatus: parseAnswerStatus(value.answer_status),
    answerNote: asString(value.answer_note),
    officialExplanation: Array.isArray(value.official_explanation)
      ? parseStemBlocks(value.official_explanation)
      : null,
    modelAnswer: asString(value.model_answer),
    gradingPoints: Array.isArray(value.grading_points)
      ? asStringArray(value.grading_points)
      : null,
  }
}

export function parseStats(value: unknown): QuestionStats {
  const empty: QuestionStats = {
    totalAttempts: 0,
    myAttempts: 0,
    correctCount: 0,
    correctRate: null,
    avgTimeSpentSec: null,
    choiceDistribution: {},
  }
  if (!isRecord(value)) return empty

  const distribution: Record<number, number> = {}
  if (isRecord(value.choice_distribution)) {
    for (const [key, count] of Object.entries(value.choice_distribution)) {
      const no = Number(key)
      if (Number.isFinite(no) && typeof count === 'number') distribution[no] = count
    }
  }

  return {
    totalAttempts: typeof value.total_attempts === 'number' ? value.total_attempts : 0,
    myAttempts: typeof value.my_attempts === 'number' ? value.my_attempts : 0,
    correctCount: typeof value.correct_count === 'number' ? value.correct_count : 0,
    correctRate: typeof value.correct_rate === 'number' ? value.correct_rate : null,
    avgTimeSpentSec:
      typeof value.avg_time_spent_sec === 'number' ? value.avg_time_spent_sec : null,
    choiceDistribution: distribution,
  }
}

export function parseSubmitResult(value: unknown): SubmitResult | null {
  if (!isRecord(value)) return null
  const answer = parseAnswerPayload(value.answer)
  if (!answer) return null

  return {
    attemptId: asString(value.attempt_id) ?? '',
    attemptNumber: typeof value.attempt_number === 'number' ? value.attempt_number : 1,
    isCorrect: typeof value.is_correct === 'boolean' ? value.is_correct : null,
    answer,
    stats: parseStats(value.stats),
  }
}

// -----------------------------------------------------------------------------
// 표시 헬퍼
// -----------------------------------------------------------------------------

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

export function circled(no: number): string {
  return CIRCLED[no - 1] ?? String(no)
}

export function formatAnswer(answer: number[]): string {
  return answer.map(circled).join('')
}

export function sameAnswer(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort((x, y) => x - y)
  const right = [...b].sort((x, y) => x - y)
  return left.every((value, index) => value === right[index])
}

export const COMPLETENESS_LABEL: Record<Completeness, string | null> = {
  complete: null,
  partial_choices: '보기 일부만 복기됨',
  partial_stem: '문제 본문 일부만 복기됨',
  image_missing: '이미지 누락',
}
