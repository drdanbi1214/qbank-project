// =============================================================================
// Tiptap(ProseMirror) 문서 타입
//
// 풀이, 개인노트, 게시글, 댓글 본문이 모두 이 형태의 jsonb 로 저장된다.
// DB 에서 온 값은 신뢰할 수 없으므로 화면에 넘기기 전에 parseRichDoc 를 통과시킨다.
//
// 위치(position) 계산은 ProseMirror 규칙을 그대로 따른다. 인라인 코멘트의
// anchor_from/anchor_to 가 에디터에서 얻은 값과 뷰어에서 계산한 값이 같아야
// 하이라이트가 어긋나지 않기 때문이다.
//   - 텍스트 노드: 글자 수
//   - 리프 노드(이미지, 수식, 구분선, 줄바꿈): 1
//   - 그 외: 여는 태그 1 + 내용 + 닫는 태그 1
// =============================================================================

import type { Json } from '@/types/database'

export type RichMark = {
  type: string
  attrs?: Record<string, unknown>
}

export type RichNode = {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  marks?: RichMark[]
  text?: string
}

export type RichDoc = {
  type: 'doc'
  content: RichNode[]
}

/**
 * jsonb 컬럼에 넣기 위한 변환.
 * attrs 가 Record<string, unknown> 이라 생성된 Json 타입과 구조적으로 겹치지 않지만,
 * 실제 값은 Tiptap 이 만든 JSON 직렬화 가능한 객체다.
 */
export function toJson(value: unknown): Json {
  return value as Json
}

/** 내용이 없는 노드. 문단 하나만 가진 빈 문서로 둔다. */
export function emptyDoc(): RichDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩']

function textParagraph(text: string): RichNode {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }
}

/**
 * 새 풀이를 작성할 때 기본으로 채워주는 서식.
 * 문항의 선지 개수만큼 "① →" 줄을 만든다 (선지가 1개면 ①만).
 */
export function solutionTemplateDoc(choiceCount: number): RichDoc {
  const content: RichNode[] = [
    textParagraph('Imp.'),
    textParagraph(''),
    textParagraph('해설: '),
    textParagraph(''),
    textParagraph('선지)'),
  ]
  const count = Math.max(choiceCount, 0)
  for (let i = 0; i < count; i += 1) {
    const label = CIRCLED[i] ?? String(i + 1)
    content.push(textParagraph(`${label} → `))
  }
  return { type: 'doc', content }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseNode(value: unknown): RichNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null

  const node: RichNode = { type: value.type }

  if (typeof value.text === 'string') node.text = value.text
  if (isRecord(value.attrs)) node.attrs = value.attrs

  if (Array.isArray(value.marks)) {
    const marks = value.marks
      .filter(isRecord)
      .filter((mark): mark is Record<string, unknown> & { type: string } => typeof mark.type === 'string')
      .map((mark) => ({
        type: mark.type,
        attrs: isRecord(mark.attrs) ? mark.attrs : undefined,
      }))
    if (marks.length > 0) node.marks = marks
  }

  if (Array.isArray(value.content)) {
    const content = value.content.map(parseNode).filter((child): child is RichNode => child !== null)
    if (content.length > 0) node.content = content
  }

  return node
}

export function parseRichDoc(value: unknown): RichDoc {
  if (!isRecord(value) || value.type !== 'doc' || !Array.isArray(value.content)) {
    return emptyDoc()
  }
  const content = value.content.map(parseNode).filter((child): child is RichNode => child !== null)
  return { type: 'doc', content }
}

/** 자식을 가질 수 없는 노드. 위치 계산에서 크기 1로 센다. */
const LEAF_TYPES = new Set([
  'image',
  'hardBreak',
  'horizontalRule',
  'mathInline',
  'mathBlock',
  // 테마 본문에 끼워 넣는 야마. 문제 하나를 통째로 가리키는 원자 노드다.
  // 반드시 여기 있어야 한다 — 빠지면 크기를 2로 세어 뒤따르는 인라인 코멘트의
  // anchor_from/anchor_to 가 전부 밀린다.
  'yamaEmbed',
  // 테마 본문에 끼워 넣는 이론 문서. 야마와 같은 이유로 여기 있어야 한다.
  'theoryEmbed',
])

export function isLeafNode(type: string): boolean {
  return LEAF_TYPES.has(type)
}

/** 이미지 폭 조절의 하한. 더 작아지면 손잡이를 다시 잡기 어렵다. */
export const MIN_IMAGE_WIDTH = 80
export const MAX_IMAGE_WIDTH = 2000

/**
 * 작성자가 정한 이미지 폭(px).
 * 저장된 문서 JSON 은 남이 만든 것도 오므로 숫자와 범위를 확인하고 쓴다.
 */
export function imageWidthOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(Math.max(Math.round(value), MIN_IMAGE_WIDTH), MAX_IMAGE_WIDTH)
}

/** ProseMirror 기준 노드 크기 */
export function nodeSize(node: RichNode): number {
  if (node.type === 'text') return node.text?.length ?? 0
  if (isLeafNode(node.type)) return 1
  return 2 + (node.content ?? []).reduce((sum, child) => sum + nodeSize(child), 0)
}

/** 목록 미리보기, 검색 인덱싱용 평문 */
export function richTextToPlain(doc: RichDoc): string {
  const parts: string[] = []

  function walk(node: RichNode) {
    if (node.type === 'text') {
      parts.push(node.text ?? '')
      return
    }
    if (node.type === 'image') {
      parts.push('[이미지]')
      return
    }
    if (node.type === 'mathInline' || node.type === 'mathBlock') {
      parts.push(typeof node.attrs?.latex === 'string' ? node.attrs.latex : '')
      return
    }
    for (const child of node.content ?? []) walk(child)
    // 블록 사이에는 공백을 넣어 단어가 붙지 않게 한다.
    if (node.content && node.content.length > 0) parts.push(' ')
  }

  for (const child of doc.content) walk(child)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

export function isEmptyDoc(doc: RichDoc): boolean {
  return richTextToPlain(doc) === '' && !hasNode(doc, 'image')
}

function hasNode(doc: RichDoc, type: string): boolean {
  let found = false
  function walk(node: RichNode) {
    if (found) return
    if (node.type === type) {
      found = true
      return
    }
    for (const child of node.content ?? []) walk(child)
  }
  for (const child of doc.content) walk(child)
  return found
}

/** 본문에 쓰인 Storage 경로. 글 삭제 시 이미지 정리에 쓴다. */
export function collectImagePaths(doc: RichDoc): string[] {
  const paths: string[] = []
  function walk(node: RichNode) {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') {
      paths.push(node.attrs.src)
    }
    for (const child of node.content ?? []) walk(child)
  }
  for (const child of doc.content) walk(child)
  return paths
}
