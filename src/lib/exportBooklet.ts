import katex from 'katex'
import { fetchQuestions, revealAnswers } from '@/lib/queries/questions'
import { fetchNotesForTargets } from '@/lib/queries/notes'
import { getSignedUrl } from '@/lib/storage'
import { circled, effectiveAnswer, type AnswerPayload, type Choice, type StemBlock } from '@/types/question'
import { richTextToPlain } from '@/types/richtext'
import type { SolveQuestion } from '@/lib/queries/questions'

/**
 * 문제집 PDF 다운로드.
 *
 * jsPDF 와 html2canvas 는 처음 눌렀을 때만 받는다. 시험을 안 보는 사용자라면
 * 이 코드를 아예 받지 않아도 되기 때문이다 (RichTextEditor 를 지연 로드하는
 * 것과 같은 이유). 렌더링은 화면 밖에 실제 DOM 을 만들어 html2canvas 로
 * 캡처하는 방식이라, 화면에서 보이는 한글 폰트와 KaTeX 수식이 그대로 찍힌다.
 * 대신 텍스트를 선택하거나 검색할 수는 없는 이미지 기반 PDF 가 된다.
 */

let pdfLibs: Promise<{
  JsPDF: typeof import('jspdf').default
  captureCanvas: typeof import('html2canvas-pro').default
}> | null = null

/**
 * jsPDF 와 html2canvas-pro 는 처음 눌렀을 때만 받는다.
 *
 * jsPDF 의 내장 `.html()` 자동 페이지 나누기는 쓰지 않는다. 캡처 해상도를
 * 낮춰도 결과물이 거의 줄지 않아 (62문항 기준 25MB 안팎) 살펴보니, PDF 에
 * 박히는 이미지가 PNG(무손실)로 고정되는 것으로 보인다. 대신 컨테이너
 * 전체를 캔버스 하나로 직접 캡처한 뒤 페이지 높이만큼 잘라 JPEG 로 압축해
 * 넣는다. 사진이 섞인 페이지에서 PNG 보다 훨씬 작다.
 *
 * html2canvas-pro 를 쓰는 이유는 Tailwind v4 가 기본 팔레트를 oklch() 로
 * 내보내는데, 원조 html2canvas 는 이 색 함수를 못 읽고 예외를 던지기
 * 때문이다. html2canvas-pro 는 oklch/oklab/lab/lch/color() 를 지원하는
 * 그대로 갈아끼울 수 있는 포크다.
 */
function loadPdfLibs() {
  if (!pdfLibs) {
    pdfLibs = Promise.all([import('jspdf'), import('html2canvas-pro')]).then(
      ([jspdf, html2canvas]) => ({ JsPDF: jspdf.default, captureCanvas: html2canvas.default }),
    )
  }
  return pdfLibs
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderStemBlocks(blocks: StemBlock[], images: Map<string, string>): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'text':
          return `<p style="margin:0 0 8px;white-space:pre-wrap;">${escapeHtml(block.content)}</p>`

        case 'labbox': {
          const rows = block.items
            .map(
              (item) =>
                `<tr><td style="padding:2px 10px 2px 0;color:#64748b;">${escapeHtml(item.label)}</td><td style="padding:2px 0;">${escapeHtml(item.value)}</td></tr>`,
            )
            .join('')
          return `<table style="margin:0 0 8px;font-size:13px;">${rows}</table>`
        }

        case 'table': {
          const header = block.headers.length
            ? `<tr>${block.headers
                .map(
                  (h) =>
                    `<th style="border:1px solid #cbd5e1;padding:4px 8px;background:#f1f5f9;text-align:left;">${escapeHtml(h)}</th>`,
                )
                .join('')}</tr>`
            : ''
          const rows = block.rows
            .map(
              (row) =>
                `<tr>${row.map((cell) => `<td style="border:1px solid #cbd5e1;padding:4px 8px;">${escapeHtml(cell)}</td>`).join('')}</tr>`,
            )
            .join('')
          return `<table style="margin:0 0 8px;border-collapse:collapse;font-size:13px;width:100%;">${header}${rows}</table>`
        }

        case 'image': {
          const src = images.get(block.url)
          if (!src) return ''
          return `<img src="${src}" crossorigin="anonymous" style="display:block;margin:4px 0 8px;max-width:100%;max-height:320px;object-fit:contain;" />`
        }

        case 'formula': {
          try {
            const html = katex.renderToString(block.latex, { throwOnError: false })
            return `<div style="margin:0 0 8px;">${html}</div>`
          } catch {
            return ''
          }
        }

        default:
          return ''
      }
    })
    .join('')
}

function renderChoices(choices: Choice[], answer: number[] | null): string {
  return `<ol style="list-style:none;margin:4px 0 0;padding:0;">${choices
    .map((choice) => {
      const marked = answer?.includes(choice.no)
      return `<li style="display:flex;gap:6px;font-size:13px;line-height:1.7;${marked ? 'font-weight:700;' : ''}"><span>${circled(choice.no)}</span><span>${escapeHtml(choice.text ?? '(이미지 보기)')}</span></li>`
    })
    .join('')}</ol>`
}

function renderQuestion(
  question: SolveQuestion,
  index: number,
  images: Map<string, string>,
  answer: AnswerPayload | null,
  note: string | null,
): string {
  const marked = answer ? effectiveAnswer(answer) : null
  const answerLine =
    marked && marked.length > 0
      ? `<p style="margin:6px 0 0;padding:5px 10px;background:#f1f5f9;border-left:3px solid #1e293b;font-size:12px;">정답 ${marked.map(circled).join('')}</p>`
      : ''
  const noteLine =
    note && note.trim().length > 0
      ? `<p style="margin:6px 0 0;padding:5px 10px;background:#eff6ff;border-left:3px solid #2563eb;font-size:12px;white-space:pre-wrap;">내 메모: ${escapeHtml(note)}</p>`
      : ''

  return `
    <div style="margin-bottom:18px;">
      <div style="display:flex;gap:8px;">
        <span style="font-weight:700;flex-shrink:0;">${index + 1}.</span>
        <div style="min-width:0;flex:1;">
          ${renderStemBlocks(question.stemBlocks, images)}
          ${question.choices.length > 0 ? renderChoices(question.choices, marked) : ''}
          ${answerLine}
          ${noteLine}
        </div>
      </div>
    </div>
  `
}

/** personal_notes 조회/저장과 같은 규칙: 그룹이 있으면 그룹, 없으면 문제 단위 */
function noteKeyOf(question: SolveQuestion): string {
  return question.groupId ?? question.id
}

async function collectImageUrls(questions: SolveQuestion[]): Promise<Map<string, string>> {
  const paths = new Set<string>()
  for (const question of questions) {
    for (const block of question.stemBlocks) {
      if (block.type === 'image') paths.add(block.url)
    }
    for (const choice of question.choices) {
      if (choice.imageUrl) paths.add(choice.imageUrl)
    }
  }

  const entries = await Promise.all(
    [...paths].map(async (path) => [path, await getSignedUrl(path)] as const),
  )
  const map = new Map<string, string>()
  for (const [path, url] of entries) if (url) map.set(path, url)
  return map
}

function buildHtml(
  title: string,
  questions: SolveQuestion[],
  images: Map<string, string>,
  answers: Map<string, AnswerPayload> | null,
  notes: Map<string, string> | null,
): string {
  const body = questions
    .map((question, index) =>
      renderQuestion(
        question,
        index,
        images,
        answers?.get(question.id) ?? null,
        notes?.get(noteKeyOf(question)) ?? null,
      ),
    )
    .join('')

  return `
    <div style="font-family:'Pretendard','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a;background:#ffffff;padding:24px;width:718px;">
      <h1 style="font-size:19px;margin:0 0 4px;">${escapeHtml(title)}</h1>
      <p style="font-size:11px;color:#64748b;margin:0 0 18px;">
        총 ${questions.length}문항${answers ? ', 정답 포함' : ''}${notes ? ', 내 메모 포함' : ''}
      </p>
      ${body}
    </div>
  `
}

async function waitForImages(container: HTMLElement): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'))
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve()
            return
          }
          img.onload = () => resolve()
          img.onerror = () => resolve()
        }),
    ),
  )
}

/** A4 여백 10mm 씩을 뺀 실제 내용 영역 */
const PAGE_WIDTH_MM = 190
const PAGE_HEIGHT_MM = 277
const MARGIN_MM = 10
const CAPTURE_SCALE = 1.5
const JPEG_QUALITY = 0.82

async function renderAndSave(html: string, filename: string): Promise<void> {
  const { JsPDF, captureCanvas } = await loadPdfLibs()

  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-10000px'
  container.style.top = '0'
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    await waitForImages(container)

    const full = await captureCanvas(container, {
      scale: CAPTURE_SCALE,
      useCORS: true,
      backgroundColor: '#ffffff',
    })

    const pxPerMm = full.width / PAGE_WIDTH_MM
    const pageHeightPx = Math.floor(PAGE_HEIGHT_MM * pxPerMm)

    const doc = new JsPDF({ unit: 'mm', format: 'a4' })
    let renderedPx = 0
    let pageIndex = 0

    while (renderedPx < full.height) {
      const sliceHeightPx = Math.min(pageHeightPx, full.height - renderedPx)

      const page = document.createElement('canvas')
      page.width = full.width
      page.height = sliceHeightPx
      const ctx = page.getContext('2d')
      if (!ctx) break
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, page.width, page.height)
      ctx.drawImage(full, 0, renderedPx, full.width, sliceHeightPx, 0, 0, full.width, sliceHeightPx)

      if (pageIndex > 0) doc.addPage()
      doc.addImage(
        page.toDataURL('image/jpeg', JPEG_QUALITY),
        'JPEG',
        MARGIN_MM,
        MARGIN_MM,
        PAGE_WIDTH_MM,
        sliceHeightPx / pxPerMm,
      )

      renderedPx += sliceHeightPx
      pageIndex += 1
    }

    doc.save(filename)
  } finally {
    document.body.removeChild(container)
  }
}

/** 안전한 파일명으로 다듬는다. 슬래시 등은 경로로 해석될 수 있어 뺀다. */
function sanitizeFilename(text: string): string {
  return text.replace(/[/\\:*?"<>|]/g, ' ').trim()
}

/** userId 가 있으면 "문제+답" 파일에 내 개인 메모를 함께 싣는다. 문제집(정답 없는 쪽)에는 넣지 않는다. */
export async function downloadExamBooklets(
  examId: string,
  examLabel: string,
  userId?: string | null,
): Promise<void> {
  const questions = await fetchQuestions({ examId })
  if (questions.length === 0) {
    throw new Error('이 시험에는 공개된 문항이 없습니다.')
  }

  const [images, answers, notes] = await Promise.all([
    collectImageUrls(questions),
    revealAnswers(questions.map((question) => question.id)),
    userId
      ? fetchNotesForTargets(questions.map((question) => ({ questionId: question.id, groupId: question.groupId })))
      : Promise.resolve(new Map()),
  ])

  const plainNotes =
    notes.size > 0
      ? new Map([...notes].map(([key, doc]) => [key, richTextToPlain(doc)] as const))
      : null

  const name = sanitizeFilename(examLabel)
  // 두 번째 다운로드가 브라우저의 팝업 차단에 걸리지 않도록 순서대로 처리한다.
  await renderAndSave(buildHtml(`${examLabel} 문제집`, questions, images, null, null), `${name} 문제집.pdf`)
  await renderAndSave(
    buildHtml(`${examLabel} 문제+답`, questions, images, answers, plainNotes),
    `${name} 문제+답.pdf`,
  )
}
