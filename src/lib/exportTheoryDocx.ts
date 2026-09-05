import type { TheoryDocument } from '@/lib/queries/theory'
import { pageCropOf } from '@/components/lecture/pageCrop'
import {
  cellShadeOf,
  colWidthsOf,
  imageLayoutOf,
  imageWidthOf,
  tableBorderOf,
  type RichMark,
  type RichNode,
} from '@/types/richtext'
import type {
  FileChild,
  IRunStylePropertiesOptions,
  Paragraph,
  ParagraphChild,
  Table,
  TableCell,
} from 'docx'

type DocxLibrary = typeof import('docx')

export type TheoryExportProgress = {
  stage: 'images' | 'document'
  completed: number
  total: number
}

type PreparedImage = {
  data: Uint8Array
  width: number
  height: number
  alt: string
}

type ExportContext = {
  docx: DocxLibrary
  subjectName: string
  baseUrl: string
  images: Map<RichNode, PreparedImage>
  footnotes: Record<string, { children: readonly Paragraph[] }>
  nextFootnoteId: number
}

const PAGE_WIDTH_DXA = 9_360
const TABLE_INDENT_DXA = 120
const PAGE_IMAGE_WIDTH_PX = 624
const PAGE_IMAGE_HEIGHT_PX = 760
const HALF_IMAGE_WIDTH_PX = 294
const IMAGE_RENDER_SCALE = 2
const IMAGE_MAX_RASTER_PX = 2_400
const IMAGE_FETCH_CONCURRENCY = 4
const IMAGE_FETCH_ATTEMPTS = 3
const BODY_FONT = '맑은 고딕'

const PROXIED_IMAGE_SOURCES: Record<string, readonly string[]> = {
  'media.allenslibrary.com': ['/theory/', '/concept/', '/problem/'],
  'dev.media.allenslibrary.com': ['/problems/'],
  's3.ap-northeast-2.amazonaws.com': ['/media.allenslibrary.com/'],
}

const CELL_SHADE: Record<string, string> = {
  yellow: 'FFF4B8',
  green: 'D9FBE8',
  blue: 'DCEEFF',
  pink: 'FCE0F0',
  gray: 'EEF0F3',
}

const TEXT_HIGHLIGHT: Record<string, string> = {
  'rgba(253, 224, 71, 0.55)': 'FDE047',
  'rgba(110, 231, 183, 0.55)': '6EE7B7',
  'rgba(125, 211, 252, 0.55)': '7DD3FC',
  'rgba(249, 168, 212, 0.55)': 'F9A8D4',
}

const FONT_SIZE: Record<string, number> = {
  '0.8em': 18,
  '0.9em': 20,
  '1.25em': 28,
  '1.5em': 33,
}

/**
 * 한 과목의 알렌 목차와 본문을 Word 파일 하나로 내보낸다.
 *
 * 화면의 임시 서명 URL을 문서에 남기지 않고 이미지 바이트를 DOCX 안에 넣는다.
 * 이미지 하나라도 준비되지 않으면 파일 생성을 중단해, 나중에 그림이 사라지는
 * 불완전한 문서가 내려가지 않게 한다.
 */
export async function exportTheoryDocumentsToDocx(params: {
  subjectName: string
  documents: TheoryDocument[]
  onProgress?: (progress: TheoryExportProgress) => void
}): Promise<void> {
  const imageNodes = collectImageNodes(params.documents)
  const images = new Map<RichNode, PreparedImage>()
  let nextImageIndex = 0
  let completedImages = 0
  params.onProgress?.({ stage: 'images', completed: 0, total: imageNodes.length })
  const workers = Array.from(
    { length: Math.min(IMAGE_FETCH_CONCURRENCY, imageNodes.length) },
    async () => {
      while (nextImageIndex < imageNodes.length) {
        const index = nextImageIndex
        nextImageIndex += 1
        const node = imageNodes[index]
        try {
          images.set(node, await prepareImage(node))
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : '알 수 없는 오류'
          throw new Error(
            `이미지 ${index + 1}/${imageNodes.length}을 포함하지 못했습니다. ${message}`,
            { cause: caught },
          )
        }
        completedImages += 1
        params.onProgress?.({
          stage: 'images',
          completed: completedImages,
          total: imageNodes.length,
        })
      }
    },
  )
  await Promise.all(workers)
  params.onProgress?.({
    stage: 'images',
    completed: imageNodes.length,
    total: imageNodes.length,
  })
  params.onProgress?.({ stage: 'document', completed: 0, total: 1 })

  const blob = await buildTheoryDocxBlob({
    subjectName: params.subjectName,
    documents: params.documents,
    images,
    baseUrl: window.location.origin,
  })

  const fileName = `${safeFileName(params.subjectName)}_알렌_${dateStamp()}.docx`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  params.onProgress?.({ stage: 'document', completed: 1, total: 1 })
}

export async function buildTheoryDocxBlob(params: {
  subjectName: string
  documents: TheoryDocument[]
  images?: Map<RichNode, PreparedImage>
  baseUrl?: string
}): Promise<Blob> {
  const docx = await import('docx')
  const context: ExportContext = {
    docx,
    subjectName: params.subjectName,
    baseUrl: params.baseUrl ?? 'https://qbank-project-three.vercel.app',
    images: params.images ?? new Map(),
    footnotes: {},
    nextFootnoteId: 1,
  }

  const body: FileChild[] = [
    new docx.Paragraph({
      children: [new docx.TextRun({ text: `${params.subjectName} 알렌`, bold: true, size: 52, color: '17365D', font: BODY_FONT })],
      alignment: docx.AlignmentType.CENTER,
      spacing: { before: 0, after: 100 },
      keepNext: true,
    }),
    new docx.Paragraph({
      children: [new docx.TextRun({ text: 'QBank 이론 정리', size: 22, color: '64748B', font: BODY_FONT })],
      alignment: docx.AlignmentType.CENTER,
      spacing: { before: 0, after: 360 },
      keepNext: true,
    }),
  ]

  const roots = orderedChildren(params.documents, null)
  for (let index = 0; index < roots.length; index += 1) {
    body.push(...await convertTheoryBranch(roots[index], params.documents, context, 0, index > 0))
  }

  const document = new docx.Document({
    creator: 'QBank',
    lastModifiedBy: 'QBank',
    title: `${params.subjectName} 알렌`,
    subject: `${params.subjectName} 알렌 이론 전체 내보내기`,
    description: 'QBank 알렌 탭에서 생성한 Word 문서',
    styles: theoryStyles(),
    numbering: theoryNumbering(docx),
    footnotes: context.footnotes,
    sections: [{
      properties: {
        page: {
          size: {
            width: 12_240,
            height: 15_840,
            orientation: docx.PageOrientation.PORTRAIT,
          },
          margin: {
            top: 1_440,
            right: 1_440,
            bottom: 1_440,
            left: 1_440,
            header: 708,
            footer: 708,
          },
        },
      },
      headers: {
        default: new docx.Header({
          children: [new docx.Paragraph({
            children: [new docx.TextRun({ text: `${params.subjectName} · 알렌`, size: 18, color: '64748B', font: BODY_FONT })],
            spacing: { after: 0 },
          })],
        }),
      },
      footers: {
        default: new docx.Footer({
          children: [new docx.Paragraph({
            children: [
              new docx.TextRun({ text: 'QBank  ·  ', size: 18, color: '94A3B8', font: BODY_FONT }),
              new docx.TextRun({ children: [docx.PageNumber.CURRENT], size: 18, color: '94A3B8', font: BODY_FONT }),
            ],
            alignment: docx.AlignmentType.RIGHT,
            spacing: { before: 0, after: 0 },
          })],
        }),
      },
      children: body,
    }],
  })

  return docx.Packer.toBlob(document)
}

async function convertTheoryBranch(
  document: TheoryDocument,
  all: TheoryDocument[],
  context: ExportContext,
  depth: number,
  pageBreakBefore: boolean,
): Promise<FileChild[]> {
  const children: FileChild[] = [theoryTitle(document.title, depth, pageBreakBefore, context.docx)]
  if (document.hasContent) children.push(...await convertBlocks(document.content.content, context, true))
  for (const child of orderedChildren(all, document.id)) {
    children.push(...await convertTheoryBranch(child, all, context, depth + 1, false))
  }
  return children
}

function theoryTitle(title: string, depth: number, pageBreakBefore: boolean, docx: DocxLibrary): Paragraph {
  const heading = depth === 0
    ? docx.HeadingLevel.HEADING_1
    : depth === 1
      ? docx.HeadingLevel.HEADING_2
      : docx.HeadingLevel.HEADING_3
  return new docx.Paragraph({
    children: [new docx.TextRun({ text: title, font: BODY_FONT })],
    heading,
    pageBreakBefore,
    keepNext: true,
  })
}

async function convertBlocks(
  nodes: RichNode[],
  context: ExportContext,
  hierarchicalIndent = false,
): Promise<FileChild[]> {
  const result: FileChild[] = []
  const inferred = hierarchicalIndent ? inferIndentLevels(nodes) : []

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node.type === 'image' && imageLayoutOf(node.attrs?.layout) === 'half') {
      const next = nodes[index + 1]
      if (next?.type === 'image' && imageLayoutOf(next.attrs?.layout) === 'half') {
        result.push(sideBySideImages(node, next, context))
        index += 1
        continue
      }
    }
    result.push(...await convertBlock(node, context, inferred[index] ?? 0))
  }
  return result
}

async function convertBlock(node: RichNode, context: ExportContext, inferredIndent = 0): Promise<FileChild[]> {
  const { docx } = context
  const indent = paragraphIndent(node, inferredIndent)
  const spacing = paragraphSpacing(node)

  switch (node.type) {
    case 'paragraph':
      return [new docx.Paragraph({
        children: inlineChildren(node.content ?? [], context),
        indent,
        spacing,
        widowControl: true,
      })]
    case 'aiTitle':
      return [new docx.Paragraph({
        children: inlineChildren(node.content ?? [], context, { bold: true }),
        indent,
        spacing: { before: 160, after: 60, line: 300 },
        keepNext: true,
      })]
    case 'aiEvidence':
      return [new docx.Paragraph({
        children: inlineChildren(node.content ?? [], context, { color: '64748B', size: 18 }),
        indent,
        spacing: { before: 0, after: 120, line: 280 },
      })]
    case 'heading': {
      const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 3
      const heading = level <= 2
        ? docx.HeadingLevel.HEADING_2
        : level === 3
          ? docx.HeadingLevel.HEADING_3
          : docx.HeadingLevel.HEADING_4
      return [new docx.Paragraph({
        children: inlineChildren(node.content ?? [], context),
        heading,
        indent,
        keepNext: true,
      })]
    }
    case 'bulletList':
      return convertList(node, context, 'bullet', 0)
    case 'orderedList':
      return convertList(node, context, 'number', 0)
    case 'blockquote':
      return [new docx.Paragraph({
        children: inlineChildren(node.content ?? [], context, { color: '475569', italics: true }),
        indent: { start: 480 + (indent?.start as number ?? 0) },
        border: { left: { style: docx.BorderStyle.SINGLE, color: '94A3B8', size: 10, space: 8 } },
        shading: { fill: 'F8FAFC' },
        spacing: { before: 80, after: 120, line: 300 },
      })]
    case 'codeBlock':
      return [new docx.Paragraph({
        children: [new docx.TextRun({ text: textOf(node), font: 'Menlo', size: 18, color: '334155' })],
        shading: { fill: 'F1F5F9' },
        indent: { start: 240, end: 240 },
        spacing: { before: 80, after: 120, line: 280 },
      })]
    case 'horizontalRule':
      return [new docx.Paragraph({
        border: { bottom: { style: docx.BorderStyle.SINGLE, color: 'CBD5E1', size: 6, space: 6 } },
        spacing: { before: 80, after: 120 },
      })]
    case 'image':
      return [imageParagraph(node, context)]
    case 'mathBlock':
      return [new docx.Paragraph({
        children: [new docx.Math({ children: [new docx.MathRun(latexOf(node))] })],
        alignment: docx.AlignmentType.CENTER,
        spacing: { before: 80, after: 120 },
        keepLines: true,
      })]
    case 'table':
      return [await convertTable(node, context)]
    case 'theoryEmbed':
      return [referenceParagraph('알렌 참조', node.attrs?.documentId, `/theory/${node.attrs?.documentId ?? ''}`, context)]
    case 'lecturePageEmbed': {
      const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '강의록'
      const page = typeof node.attrs?.page === 'number' ? ` · ${node.attrs.page}쪽` : ''
      const lectureId = typeof node.attrs?.lectureId === 'string' ? node.attrs.lectureId : ''
      return [referenceParagraph('강의록 참조', `${title}${page}`, `/lectures/${lectureId}`, context)]
    }
    case 'yamaEmbed':
      return [referenceParagraph('문항 참조', node.attrs?.questionId, '', context)]
    case 'video': {
      const source = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
      return [referenceParagraph('영상', source || '첨부 영상', source, context)]
    }
    default: {
      const children: FileChild[] = []
      for (const child of node.content ?? []) children.push(...await convertBlock(child, context))
      return children
    }
  }
}

async function convertList(
  node: RichNode,
  context: ExportContext,
  kind: 'bullet' | 'number',
  level: number,
): Promise<FileChild[]> {
  const result: FileChild[] = []
  const { docx } = context

  for (const item of node.content ?? []) {
    let firstParagraph = true
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') {
        result.push(new docx.Paragraph({
          children: inlineChildren(child.content ?? [], context),
          numbering: firstParagraph
            ? { reference: kind === 'bullet' ? 'theory-bullets' : 'theory-numbers', level: Math.min(level, 8) }
            : undefined,
          indent: firstParagraph ? undefined : { start: 540 + Math.min(level, 8) * 360 },
          spacing: paragraphSpacing(child),
          widowControl: true,
        }))
        firstParagraph = false
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        result.push(...await convertList(
          child,
          context,
          child.type === 'bulletList' ? 'bullet' : 'number',
          level + 1,
        ))
      } else {
        result.push(...await convertBlock(child, context))
      }
    }
  }
  return result
}

async function convertTable(node: RichNode, context: ExportContext): Promise<Table> {
  const { docx } = context
  const sourceRows = (node.content ?? []).filter((child) => child.type === 'tableRow')
  const columnWidths = tableColumnWidths(node)
  const borderMode = tableBorderOf(node.attrs?.border)
  const borderSize = borderMode === 'bold' ? 14 : 6
  const border = { style: docx.BorderStyle.SINGLE, color: borderMode === 'bold' ? '475569' : '94A3B8', size: borderSize }
  const borders = borderMode === 'none'
    ? docx.TableBorders.NONE
    : { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }

  const activeRowSpans = Array.from({ length: columnWidths.length }, () => 0)
  const rows: InstanceType<DocxLibrary['TableRow']>[] = []
  for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
    const row = sourceRows[rowIndex]
    let columnIndex = 0
    const cells: TableCell[] = []
    for (const cell of row.content ?? []) {
      const columnSpan = positiveInt(cell.attrs?.colspan) ?? 1
      const rowSpan = positiveInt(cell.attrs?.rowspan) ?? 1
      while (
        columnIndex < columnWidths.length
        && activeRowSpans.slice(columnIndex, columnIndex + columnSpan).some((remaining) => remaining > 0)
      ) {
        columnIndex += 1
      }
      const width = columnWidths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, value) => sum + value, 0)
      if (rowSpan > 1) {
        for (let offset = 0; offset < columnSpan; offset += 1) {
          activeRowSpans[columnIndex + offset] = Math.max(activeRowSpans[columnIndex + offset] ?? 0, rowSpan)
        }
      }
      columnIndex += columnSpan
      const shade = cellShadeOf(cell.attrs?.shade)
      const cellChildren = await convertCellChildren(cell, context)
      cells.push(new docx.TableCell({
        children: cellChildren.length > 0 ? cellChildren : [new docx.Paragraph('')],
        width: { size: width, type: docx.WidthType.DXA },
        columnSpan: columnSpan > 1 ? columnSpan : undefined,
        rowSpan: rowSpan > 1 ? rowSpan : undefined,
        verticalAlign: docx.VerticalAlign.CENTER,
        shading: shade
          ? { fill: CELL_SHADE[shade], type: docx.ShadingType.CLEAR }
          : cell.type === 'tableHeader'
            ? { fill: 'E8EEF5', type: docx.ShadingType.CLEAR }
            : undefined,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        borders: borderMode === 'none' ? docx.TableBorders.NONE : undefined,
      }))
    }
    rows.push(new docx.TableRow({
      children: cells,
      tableHeader: rowIndex === 0 && (row.content ?? []).some((cell) => cell.type === 'tableHeader'),
    }))
    for (let index = 0; index < activeRowSpans.length; index += 1) {
      activeRowSpans[index] = Math.max(0, activeRowSpans[index] - 1)
    }
  }

  return new docx.Table({
    rows,
    width: { size: PAGE_WIDTH_DXA, type: docx.WidthType.DXA },
    columnWidths,
    indent: { size: TABLE_INDENT_DXA, type: docx.WidthType.DXA },
    layout: docx.TableLayoutType.FIXED,
    borders,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
  })
}

async function convertCellChildren(node: RichNode, context: ExportContext): Promise<(Paragraph | Table)[]> {
  const converted = await convertBlocks(node.content ?? [], context)
  return converted.filter((child): child is Paragraph | Table => (
    child instanceof context.docx.Paragraph || child instanceof context.docx.Table
  ))
}

function inlineChildren(
  nodes: RichNode[],
  context: ExportContext,
  overrides: { bold?: boolean; italics?: boolean; color?: string; size?: number } = {},
): ParagraphChild[] {
  const result: ParagraphChild[] = []
  const { docx } = context

  for (const node of nodes) {
    if (node.type === 'text') {
      const options = textRunOptions(node.marks ?? [])
      const run = new docx.TextRun({ text: node.text ?? '', font: BODY_FONT, ...options, ...overrides })
      const link = (node.marks ?? []).find((mark) => mark.type === 'link')
      const href = typeof link?.attrs?.href === 'string' ? absoluteUrl(link.attrs.href, context.baseUrl) : null
      result.push(href ? new docx.ExternalHyperlink({ children: [run], link: href }) : run)
      continue
    }
    if (node.type === 'hardBreak') {
      result.push(new docx.TextRun({ break: 1, font: BODY_FONT }))
      continue
    }
    if (node.type === 'image') {
      result.push(imageRun(node, context))
      continue
    }
    if (node.type === 'mathInline') {
      result.push(new docx.Math({ children: [new docx.MathRun(latexOf(node))] }))
      continue
    }
    if (node.type === 'footnote') {
      const id = context.nextFootnoteId
      context.nextFootnoteId += 1
      const text = typeof node.attrs?.text === 'string' ? node.attrs.text : ''
      context.footnotes[String(id)] = {
        children: [new docx.Paragraph({
          children: [new docx.TextRun({ text, font: BODY_FONT, size: 18 })],
          spacing: { after: 40, line: 260 },
        })],
      }
      result.push(new docx.FootnoteReferenceRun(id))
      continue
    }
    result.push(...inlineChildren(node.content ?? [], context, overrides))
  }
  return result
}

function textRunOptions(marks: RichMark[]): IRunStylePropertiesOptions {
  const options: {
    bold?: boolean
    italics?: boolean
    underline?: { type: 'single' }
    strike?: boolean
    color?: string
    size?: number
    shading?: { fill: string; type: 'clear' }
    font?: string
  } = {}
  for (const mark of marks) {
    if (mark.type === 'bold') options.bold = true
    if (mark.type === 'italic') options.italics = true
    if (mark.type === 'underline') options.underline = { type: 'single' }
    if (mark.type === 'strike') options.strike = true
    if (mark.type === 'code') options.font = 'Menlo'
    if (mark.type === 'highlight' && typeof mark.attrs?.color === 'string') {
      const fill = TEXT_HIGHLIGHT[mark.attrs.color]
      if (fill) options.shading = { fill, type: 'clear' }
    }
    if (mark.type === 'textStyle') {
      if (typeof mark.attrs?.color === 'string' && /^#[0-9a-f]{6}$/i.test(mark.attrs.color)) {
        options.color = mark.attrs.color.slice(1).toUpperCase()
      }
      if (typeof mark.attrs?.fontSize === 'string') options.size = FONT_SIZE[mark.attrs.fontSize]
    }
  }
  return options
}

function imageParagraph(node: RichNode, context: ExportContext): Paragraph {
  return new context.docx.Paragraph({
    children: [imageRun(node, context)],
    alignment: context.docx.AlignmentType.CENTER,
    spacing: { before: 80, after: 120 },
    keepLines: true,
  })
}

function imageRun(node: RichNode, context: ExportContext): InstanceType<DocxLibrary['ImageRun']> {
  const image = context.images.get(node)
  if (!image) throw new Error('본문 이미지를 문서에 포함하지 못했습니다. 다시 시도해 주세요.')
  return new context.docx.ImageRun({
    type: 'png',
    data: image.data,
    transformation: { width: image.width, height: image.height },
    altText: { name: image.alt, title: image.alt, description: image.alt },
  })
}

function sideBySideImages(left: RichNode, right: RichNode, context: ExportContext): Table {
  const { docx } = context
  const cell = (node: RichNode) => new docx.TableCell({
    children: [imageParagraph(node, context)],
    width: { size: PAGE_WIDTH_DXA / 2, type: docx.WidthType.DXA },
    verticalAlign: docx.VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    borders: docx.TableBorders.NONE,
  })
  return new docx.Table({
    rows: [new docx.TableRow({ children: [cell(left), cell(right)], cantSplit: true })],
    width: { size: PAGE_WIDTH_DXA, type: docx.WidthType.DXA },
    columnWidths: [PAGE_WIDTH_DXA / 2, PAGE_WIDTH_DXA / 2],
    layout: docx.TableLayoutType.FIXED,
    borders: docx.TableBorders.NONE,
    margins: { top: 0, bottom: 0, left: 40, right: 40 },
  })
}

function referenceParagraph(label: string, value: unknown, href: string, context: ExportContext): Paragraph {
  const text = typeof value === 'string' && value.trim() !== '' ? value : '연결된 항목'
  const children: ParagraphChild[] = [
    new context.docx.TextRun({ text: `${label}: `, bold: true, color: '1F4D78', font: BODY_FONT }),
  ]
  const run = new context.docx.TextRun({ text, color: '2563EB', underline: { type: context.docx.UnderlineType.SINGLE }, font: BODY_FONT })
  children.push(href ? new context.docx.ExternalHyperlink({ children: [run], link: absoluteUrl(href, context.baseUrl) }) : run)
  return new context.docx.Paragraph({
    children,
    shading: { fill: 'F4F6F9', type: context.docx.ShadingType.CLEAR },
    indent: { start: 240, end: 240 },
    spacing: { before: 80, after: 120, line: 300 },
  })
}

function tableColumnWidths(node: RichNode): number[] {
  const firstRow = (node.content ?? []).find((child) => child.type === 'tableRow')
  const source: number[] = []
  for (const cell of firstRow?.content ?? []) {
    const span = positiveInt(cell.attrs?.colspan) ?? 1
    const widths = colWidthsOf(cell.attrs?.colwidth)
    for (let index = 0; index < span; index += 1) source.push(widths?.[index] ?? 0)
  }
  if (source.length === 0) return [PAGE_WIDTH_DXA]

  const known = source.filter((value) => value > 0)
  const fallback = known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : 1
  const normalized = source.map((value) => value > 0 ? value : fallback)
  const total = normalized.reduce((sum, value) => sum + value, 0)
  const scaled = normalized.map((value) => Math.max(1, Math.round(value / total * PAGE_WIDTH_DXA)))
  scaled[scaled.length - 1] += PAGE_WIDTH_DXA - scaled.reduce((sum, value) => sum + value, 0)
  return scaled
}

function paragraphIndent(node: RichNode, inferredIndent: number): { start: number } | undefined {
  const explicit = typeof node.attrs?.indent === 'number' && Number.isFinite(node.attrs.indent)
    ? Math.min(Math.max(Math.floor(node.attrs.indent), 0), 8)
    : 0
  const start = (explicit + inferredIndent) * 360
  return start > 0 ? { start } : undefined
}

function paragraphSpacing(node: RichNode): { before: number; after: number; line: number } {
  const lineHeight = node.attrs?.lineHeight
  const line = lineHeight === '1.3' ? 312 : lineHeight === '1.9' ? 456 : 300
  return { before: 0, after: 120, line }
}

function inferIndentLevels(nodes: RichNode[]): number[] {
  let previousLevel = 0
  return nodes.map((node) => {
    const text = textOf(node)
    let level: number
    if (/^\s*\d+\./.test(text)) level = 0
    else if (/^\s*\d+\)/.test(text)) level = 1
    else if (/^\s*\(\d+\)/.test(text)) level = 2
    else if (/^\s*[\u2460-\u2473]/.test(text)) level = 3
    else if (node.type === 'bulletList' || /^\s*[-*+]\s+/.test(text)) level = previousLevel
    else level = 0
    if (node.type !== 'bulletList' && !/^\s*[-*+]\s+/.test(text)) previousLevel = level
    return level
  })
}

function theoryStyles(): ConstructorParameters<DocxLibrary['Document']>[0]['styles'] {
  return {
    default: {
      document: {
        run: { font: BODY_FONT, size: 22, color: '0F172A' },
        paragraph: { spacing: { before: 0, after: 120, line: 300 } },
      },
      heading1: {
        run: { font: BODY_FONT, size: 32, bold: true, color: '2E74B5' },
        paragraph: { spacing: { before: 360, after: 200 }, keepNext: true, outlineLevel: 0 },
      },
      heading2: {
        run: { font: BODY_FONT, size: 26, bold: true, color: '2E74B5' },
        paragraph: { spacing: { before: 280, after: 140 }, keepNext: true, outlineLevel: 1 },
      },
      heading3: {
        run: { font: BODY_FONT, size: 24, bold: true, color: '1F4D78' },
        paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 2 },
      },
      heading4: {
        run: { font: BODY_FONT, size: 22, bold: true, color: '1F4D78' },
        paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 3 },
      },
      hyperlink: { run: { color: '2563EB', underline: { type: 'single' } } },
    },
  }
}

function theoryNumbering(docx: DocxLibrary): ConstructorParameters<DocxLibrary['Document']>[0]['numbering'] {
  const levels = (kind: 'bullet' | 'number') => Array.from({ length: 9 }, (_, level) => ({
    level,
    format: kind === 'bullet' ? docx.LevelFormat.BULLET : docx.LevelFormat.DECIMAL,
    text: kind === 'bullet' ? (level % 2 === 0 ? '•' : '◦') : `%${level + 1}.`,
    alignment: docx.AlignmentType.LEFT,
    style: {
      run: { font: BODY_FONT, size: 22 },
      paragraph: {
        indent: { start: 540 + level * 360, hanging: 270 },
        spacing: { before: 0, after: 80, line: 300 },
      },
    },
  }))
  return {
    config: [
      { reference: 'theory-bullets', levels: levels('bullet') },
      { reference: 'theory-numbers', levels: levels('number') },
    ],
  }
}

function orderedChildren(documents: TheoryDocument[], parentId: string | null): TheoryDocument[] {
  return documents
    .filter((document) => document.parentId === parentId)
    .sort((a, b) => {
      const aNumber = leadingNumber(a.title)
      const bNumber = leadingNumber(b.title)
      if (aNumber !== null && bNumber !== null && aNumber !== bNumber) return aNumber - bNumber
      return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ko', { numeric: true })
    })
}

function leadingNumber(title: string): number | null {
  const match = title.match(/^\s*(\d+)/)
  return match ? Number(match[1]) : null
}

function collectImageNodes(documents: TheoryDocument[]): RichNode[] {
  const result: RichNode[] = []
  const walk = (node: RichNode) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') result.push(node)
    for (const child of node.content ?? []) walk(child)
  }
  for (const document of documents) for (const node of document.content.content) walk(node)
  return result
}

async function prepareImage(node: RichNode): Promise<PreparedImage> {
  const path = typeof node.attrs?.src === 'string' ? node.attrs.src : null
  if (!path) throw new Error('경로가 없는 본문 이미지가 있어 내보내기를 중단했습니다.')
  const { getSignedUrl } = await import('@/lib/storage')
  const url = await getSignedUrl(path)
  if (!url) throw new Error('본문 이미지의 접근 주소를 만들지 못했습니다. 다시 로그인한 뒤 시도해 주세요.')
  const sourceBlob = await fetchImageBlob(url)
  const decoded = await decodeImage(sourceBlob)
  try {
    const crop = pageCropOf(node.attrs?.crop)
    const sourceX = crop ? Math.round(decoded.width * crop.x) : 0
    const sourceY = crop ? Math.round(decoded.height * crop.y) : 0
    const sourceWidth = crop ? Math.max(1, Math.round(decoded.width * crop.width)) : decoded.width
    const sourceHeight = crop ? Math.max(1, Math.round(decoded.height * crop.height)) : decoded.height
    const maxDisplayWidth = imageLayoutOf(node.attrs?.layout) === 'half'
      ? HALF_IMAGE_WIDTH_PX
      : PAGE_IMAGE_WIDTH_PX
    const requestedWidth = imageWidthOf(node.attrs?.width)
    let displayWidth = Math.max(1, Math.min(requestedWidth ?? sourceWidth, maxDisplayWidth))
    let displayHeight = Math.max(1, Math.round(displayWidth * sourceHeight / sourceWidth))
    if (displayHeight > PAGE_IMAGE_HEIGHT_PX) {
      displayWidth = Math.max(1, Math.round(displayWidth * PAGE_IMAGE_HEIGHT_PX / displayHeight))
      displayHeight = PAGE_IMAGE_HEIGHT_PX
    }
    const rasterScale = Math.min(
      1,
      displayWidth * IMAGE_RENDER_SCALE / sourceWidth,
      displayHeight * IMAGE_RENDER_SCALE / sourceHeight,
      IMAGE_MAX_RASTER_PX / sourceWidth,
      IMAGE_MAX_RASTER_PX / sourceHeight,
    )
    const rasterWidth = Math.max(1, Math.round(sourceWidth * rasterScale))
    const rasterHeight = Math.max(1, Math.round(sourceHeight * rasterScale))

    const canvas = document.createElement('canvas')
    canvas.width = rasterWidth
    canvas.height = rasterHeight
    const drawing = canvas.getContext('2d')
    if (!drawing) throw new Error('이미지 변환을 시작하지 못했습니다.')
    drawing.fillStyle = '#ffffff'
    drawing.fillRect(0, 0, rasterWidth, rasterHeight)
    drawing.drawImage(decoded.source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, rasterWidth, rasterHeight)
    const blob = await canvasBlob(canvas)
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width: Math.round(displayWidth),
      height: displayHeight,
      alt: typeof node.attrs?.alt === 'string' && node.attrs.alt.trim() !== ''
        ? node.attrs.alt
        : '알렌 본문 이미지',
    }
  } finally {
    decoded.close()
  }
}

async function fetchImageBlob(sourceUrl: string): Promise<Blob> {
  const requestUrl = proxiedImageUrl(sourceUrl) ?? sourceUrl
  let lastError: Error | null = null

  for (let attempt = 0; attempt < IMAGE_FETCH_ATTEMPTS; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(requestUrl, { signal: controller.signal })
      if (response.ok) return await response.blob()
      lastError = new Error(`이미지 서버가 HTTP ${response.status}로 응답했습니다.`)
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        break
      }
    } catch (caught) {
      lastError = caught instanceof Error ? caught : new Error(String(caught))
    } finally {
      window.clearTimeout(timeout)
    }
    if (attempt < IMAGE_FETCH_ATTEMPTS - 1) await wait(350 * 2 ** attempt)
  }

  if (lastError?.name === 'AbortError') {
    throw new Error('이미지 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.')
  }
  throw new Error('이미지 원본을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.')
}

function proxiedImageUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl)
    const prefixes = PROXIED_IMAGE_SOURCES[url.hostname.toLowerCase()]
    if (!prefixes?.some((prefix) => url.pathname.startsWith(prefix))) return null
    return `/api/theory-export-image?url=${encodeURIComponent(url.toString())}`
  } catch {
    return null
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function decodeImage(blob: Blob): Promise<{
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(blob)
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      // Safari 버전에 따라 SVG·GIF를 createImageBitmap으로 읽지 못할 수 있다.
      // 아래 HTMLImageElement 경로로 한 번 더 시도한다.
    }
  }

  const url = URL.createObjectURL(blob)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('이미지를 Word 형식으로 바꾸지 못했습니다.'))
    }, 'image/png')
  })
}

function textOf(node: RichNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textOf).join('')
}

function latexOf(node: RichNode): string {
  return typeof node.attrs?.latex === 'string' ? node.attrs.latex : ''
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null
}

function absoluteUrl(value: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(value)) return value
  try {
    return new URL(value, baseUrl).toString()
  } catch {
    return baseUrl
  }
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim() || '알렌'
}

function dateStamp(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}
