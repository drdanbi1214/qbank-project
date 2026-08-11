import { useMemo, useRef, useState } from 'react'
import { DesktopOnly } from '@/components/DesktopOnly'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useData } from '@/lib/data'
import { examShortLabel } from '@/lib/queries/taxonomy'
import { insertQuestions, type QuestionDraft } from '@/lib/queries/admin'
import { downloadCsv } from '@/utils/download'
import type { AnswerStatus, Completeness, QuestionType } from '@/types/question'
import { cn } from '@/utils/cn'

/**
 * CSV 일괄 업로드.
 *
 * 엑셀에서 정리한 문항을 한 번에 올린다. 본문 블록 구조를 전부 표현할 수는 없어
 * 텍스트 한 덩이와 보기, 정답만 받는다. 표나 이미지가 필요한 문항은 올린 뒤
 * 문제 관리나 PDF 검수 화면에서 채운다.
 */
const COLUMNS = [
  'question_number',
  'stem',
  'choice1',
  'choice2',
  'choice3',
  'choice4',
  'choice5',
  'yama_answer',
  'editor_answer',
  'answer_status',
  'completeness',
  'professor',
  'restorer_note',
] as const

type ParsedRow = {
  line: number
  draft: QuestionDraft | null
  error: string | null
}

/** 따옴표와 줄바꿈이 들어간 셀까지 처리하는 최소 CSV 파서 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }

    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') {
      cell += char
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ''))
}

function parseAnswerList(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => Number(part.trim()))
    .filter((num) => Number.isInteger(num) && num > 0)
}

export function AdminUploadPage() {
  const { taxonomy, refreshAll } = useData()
  const fileInput = useRef<HTMLInputElement>(null)

  const [examId, setExamId] = useState('')
  const [rows, setRows] = useState<ParsedRow[] | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const valid = useMemo(() => (rows ?? []).filter((row) => row.draft !== null), [rows])
  const invalid = useMemo(() => (rows ?? []).filter((row) => row.draft === null), [rows])

  function readFile(file: File) {
    setError(null)
    setResult(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = () => {
      const table = parseCsv(String(reader.result ?? ''))
      if (table.length < 2) {
        setError('머리글과 데이터가 모두 필요합니다.')
        setRows(null)
        return
      }

      const header = table[0].map((name) => name.trim().toLowerCase())
      const indexOf = (name: string) => header.indexOf(name)
      if (indexOf('question_number') === -1 || indexOf('stem') === -1) {
        setError('question_number 와 stem 열은 반드시 있어야 합니다.')
        setRows(null)
        return
      }

      const parsed: ParsedRow[] = table.slice(1).map((line, offset) => {
        const cell = (name: string) => {
          const at = indexOf(name)
          return at === -1 ? '' : (line[at] ?? '').trim()
        }

        const number = Number(cell('question_number'))
        const stem = cell('stem')
        if (!Number.isInteger(number) || number <= 0) {
          return { line: offset + 2, draft: null, error: '문항 번호가 올바르지 않습니다.' }
        }
        if (stem === '') {
          return { line: offset + 2, draft: null, error: '본문이 비어 있습니다.' }
        }

        const choices = [1, 2, 3, 4, 5]
          .map((no) => ({ no, text: cell(`choice${no}`), imageUrl: null }))
          .filter((choice) => choice.text !== '')
          .map((choice, index) => ({ ...choice, no: index + 1 }))

        const editorAnswer = parseAnswerList(cell('editor_answer'))
        const yamaAnswer = parseAnswerList(cell('yama_answer'))

        const draft: QuestionDraft = {
          examId,
          unitId: null,
          questionNumber: number,
          questionType: (choices.length === 0 ? 'essay' : 'A') as QuestionType,
          setId: null,
          stemBlocks: [{ type: 'text', content: stem }],
          choices,
          answerCount: Math.max(1, editorAnswer.length || yamaAnswer.length || 1),
          editorAnswer,
          yamaAnswer: yamaAnswer.length > 0 ? yamaAnswer : null,
          answerStatus: (cell('answer_status') || 'unconfirmed') as AnswerStatus,
          answerNote: null,
          officialExplanation: null,
          modelAnswer: null,
          gradingPoints: null,
          professor: cell('professor') || null,
          restorerNote: cell('restorer_note') || null,
          sourceTags: [],
          variantType: 'original',
          groupId: null,
          completeness: (cell('completeness') || 'complete') as Completeness,
          status: 'draft',
        }
        return { line: offset + 2, draft, error: null }
      })

      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
  }

  async function upload() {
    if (!examId) {
      setError('시험을 먼저 고르세요.')
      return
    }
    if (valid.length === 0) return

    setBusy(true)
    setError(null)
    try {
      const count = await insertQuestions(
        valid.map((row) => ({ ...(row.draft as QuestionDraft), examId })),
      )
      setResult(`${count}문항을 올렸습니다. 검수 중 상태로 들어가 있습니다.`)
      setRows(null)
      setFileName(null)
      refreshAll()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '올리지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DesktopOnly>
      <section className="max-w-4xl">
        <header className="mb-4">
          <h1 className="text-xl font-bold">CSV 일괄 업로드</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            엑셀에서 정리한 문항을 한 번에 등록합니다. 올린 문항은 검수 중 상태라
            학생 화면에는 바로 뜨지 않습니다.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={examId}
            onChange={(event) => setExamId(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            aria-label="시험"
          >
            <option value="">시험 선택</option>
            {(taxonomy?.exams ?? []).map((exam) => (
              <option key={exam.id} value={exam.id}>
                {examShortLabel(exam, taxonomy?.subjectById.get(exam.subjectId)?.name)}{' '}
                {exam.examName}
              </option>
            ))}
          </select>

          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            CSV 파일 고르기
          </Button>
          {fileName && <span className="text-sm text-slate-500">{fileName}</span>}

          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() =>
              downloadCsv('문항_업로드_양식', [
                [...COLUMNS],
                [
                  1,
                  '58세 남자가 3일 전부터 오른쪽 옆구리 통증으로 왔다. 가장 적절한 검사는?',
                  '복부 초음파',
                  '복부 CT',
                  '단순 복부 X선',
                  'MRI',
                  '',
                  '2',
                  '',
                  'unconfirmed',
                  'complete',
                  '',
                  '',
                ],
              ])
            }
          >
            양식 내려받기
          </Button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) readFile(file)
            event.target.value = ''
          }}
        />

        {error && (
          <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </p>
        )}
        {result && (
          <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
            {result}
          </p>
        )}

        {rows && (
          <>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-sm">
                읽은 행 {rows.length}개 중{' '}
                <span className="font-semibold text-brand-600 dark:text-brand-300">
                  {valid.length}개
                </span>{' '}
                올릴 수 있습니다.
                {invalid.length > 0 && (
                  <span className="ml-1 text-marker-red">{invalid.length}개는 건너뜁니다.</span>
                )}
              </p>
              <Button className="ml-auto" onClick={() => void upload()} disabled={busy || !examId}>
                {busy && <Spinner className="h-4 w-4 border-white/40 border-t-white" />}
                {valid.length}문항 올리기
              </Button>
            </div>

            <div className="max-h-[28rem] overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full min-w-max text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">행</th>
                    <th className="px-3 py-2 text-left font-medium">번호</th>
                    <th className="px-3 py-2 text-left font-medium">본문</th>
                    <th className="px-3 py-2 text-left font-medium">보기</th>
                    <th className="px-3 py-2 text-left font-medium">정답</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((row) => (
                    <tr
                      key={row.line}
                      className={cn(row.draft === null && 'bg-rose-50 dark:bg-rose-950/20')}
                    >
                      <td className="px-3 py-1.5 tabular-nums text-slate-400">{row.line}</td>
                      {row.draft ? (
                        <>
                          <td className="px-3 py-1.5 tabular-nums">{row.draft.questionNumber}</td>
                          <td className="max-w-md truncate px-3 py-1.5">
                            {row.draft.stemBlocks[0]?.type === 'text'
                              ? row.draft.stemBlocks[0].content
                              : ''}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">{row.draft.choices.length}개</td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {row.draft.editorAnswer.join(', ') ||
                              (row.draft.yamaAnswer ?? []).join(', ') ||
                              '-'}
                          </td>
                        </>
                      ) : (
                        <td colSpan={4} className="px-3 py-1.5 text-marker-red">
                          {row.error}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-2 font-semibold">열 설명</h2>
          <ul className="space-y-1 text-slate-600 dark:text-slate-300">
            <li>
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">question_number</code>,{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">stem</code> 은 필수입니다.
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">choice1~5</code> 중 빈
              칸은 자동으로 빠지고 번호가 다시 매겨집니다. 보기가 하나도 없으면 서술형으로 봅니다.
            </li>
            <li>
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">yama_answer</code>,{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">editor_answer</code> 는{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">2</code> 또는{' '}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">1,3</code> 처럼 씁니다.
            </li>
            <li>표, 이미지, 수식이 있는 문항은 올린 뒤 문제 관리나 PDF 검수에서 채웁니다.</li>
          </ul>
        </div>
      </section>
    </DesktopOnly>
  )
}
