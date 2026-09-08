import { supabase } from '@/lib/supabase'
import type { Database } from '@/types/database'
import {
  emptyDoc,
  parseRichDoc,
  richTextToPlain,
  toJson,
  type RichDoc,
  type RichNode,
} from '@/types/richtext'

export type PersonalMemo = {
  id: string
  documentId: string
  from: number
  to: number
  selectedText: string
  content: RichDoc
  color: TheoryMemoColor
}

export type TheoryMemo = PersonalMemo

export const THEORY_MEMO_COLORS = ['yellow', 'rose', 'green', 'blue', 'violet'] as const
export type TheoryMemoColor = (typeof THEORY_MEMO_COLORS)[number]

function safeTheoryMemoColor(value: unknown): TheoryMemoColor {
  return typeof value === 'string' && THEORY_MEMO_COLORS.includes(value as TheoryMemoColor)
    ? value as TheoryMemoColor
    : 'yellow'
}

type TheoryMemoRow = {
  id: string
  document_id: string
  anchor_from: number
  anchor_to: number
  selected_text: string
  body: string
  image_paths: string[]
  content?: unknown
  color?: string
}

/** 기존 텍스트/첨부형 메모를 문서형 메모로 손실 없이 읽는다. */
function legacyContent(body: string, imagePaths: string[]): RichDoc {
  const content: RichNode[] = body.length > 0
    ? body.split('\n').map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : undefined,
      }))
    : [{ type: 'paragraph' }]

  for (const src of imagePaths) {
    content.push({ type: 'image', attrs: { src } })
    // 마지막이 이미지여도 그 뒤를 눌러 바로 글을 쓸 수 있게 빈 문단을 둔다.
    content.push({ type: 'paragraph' })
  }
  return { type: 'doc', content }
}

function fromRow(row: TheoryMemoRow): TheoryMemo {
  return {
    id: row.id,
    documentId: row.document_id,
    from: row.anchor_from,
    to: row.anchor_to,
    selectedText: row.selected_text,
    content: row.content == null
      ? legacyContent(row.body, row.image_paths)
      : parseRichDoc(row.content),
    color: safeTheoryMemoColor(row.color),
  }
}

export async function fetchTheoryMemos(documentId: string): Promise<TheoryMemo[]> {
  const { data, error } = await supabase
    .from('theory_memos')
    // 배포 중 content/color 마이그레이션보다 화면 코드가 먼저 올라가도 기존
    // 컬럼 조회까지 함께 실패하지 않도록 현재 존재하는 열 전체를 읽는다.
    .select('*')
    .eq('document_id', documentId)
    .order('anchor_from')
    .order('created_at')

  if (error) throw error
  return (data ?? []).map((row) => fromRow(row as TheoryMemoRow))
}

function missingColumn(error: { message: string; details?: string }, column: string): boolean {
  const message = `${error.message} ${error.details ?? ''}`.toLowerCase()
  return message.includes(column.toLowerCase()) && (
    message.includes('column') || message.includes('schema cache')
  )
}

export async function createTheoryMemo(params: {
  userId: string
  documentId: string
  from: number
  to: number
  selectedText: string
}): Promise<TheoryMemo> {
  const values: Database['public']['Tables']['theory_memos']['Insert'] = {
    user_id: params.userId,
    document_id: params.documentId,
    anchor_from: params.from,
    anchor_to: params.to,
    selected_text: params.selectedText.slice(0, 500),
    body: '',
    image_paths: [],
    content: toJson(emptyDoc()),
    color: 'yellow',
  }

  // 이전 탭과 새 탭이 섞이는 배포 시점에도 메모 생성 자체는 막히지 않는다.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from('theory_memos')
      .insert(values)
      .select('*')
      .single()

    if (!error) return fromRow(data as TheoryMemoRow)
    if (values.color !== undefined && missingColumn(error, 'color')) {
      delete values.color
      continue
    }
    if (values.content !== undefined && missingColumn(error, 'content')) {
      delete values.content
      continue
    }
    throw error
  }

  throw new Error('메모를 만들지 못했습니다.')
}

function imagePathsOf(doc: RichDoc): string[] {
  const paths: string[] = []
  const walk = (nodes: RichNode[] | undefined) => {
    for (const node of nodes ?? []) {
      const src = node.type === 'image' ? node.attrs?.src : null
      if (typeof src === 'string' && src !== '') paths.push(src)
      walk(node.content)
    }
  }
  walk(doc.content)
  return paths.slice(0, 12)
}

export async function updateTheoryMemo(
  id: string,
  content: RichDoc,
): Promise<void> {
  const { error } = await supabase
    .from('theory_memos')
    .update({
      content: toJson(content),
      // 구버전 화면과 내보내기 코드가 읽어도 최소한 텍스트는 유지된다.
      body: richTextToPlain(content).slice(0, 10_000),
    })
    .eq('id', id)
  if (!error) return
  if (!missingColumn(error, 'content')) throw error

  // content 열이 아직 없는 구버전 DB에는 기존 body/image_paths 형식으로라도
  // 저장하여 사용자가 방금 쓴 메모가 사라지지 않게 한다.
  const { error: legacyError } = await supabase
    .from('theory_memos')
    .update({
      body: richTextToPlain(content).slice(0, 10_000),
      image_paths: imagePathsOf(content),
    })
    .eq('id', id)
  if (legacyError) throw legacyError
}

export async function updateTheoryMemoColor(
  id: string,
  color: TheoryMemoColor,
): Promise<void> {
  const { error } = await supabase.from('theory_memos').update({ color }).eq('id', id)
  if (error) throw error
}

export async function deleteTheoryMemo(id: string): Promise<void> {
  const { error } = await supabase.from('theory_memos').delete().eq('id', id)
  if (error) throw error
}
