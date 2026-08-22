import { supabase } from '@/lib/supabase'
import { parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

/**
 * 풀이는 그룹이 있으면 group_id, 없으면 question_id 에 매단다.
 * 조회할 때는 두 경우를 모두 훑어야 한다. 문제가 나중에 중복 그룹으로 묶이면
 * 그 이전에 question_id 로 달린 풀이가 그대로 남아 있기 때문이다.
 */
export type SolutionTarget = {
  questionId: string
  groupId: string | null
}

export type Author = {
  id: string
  displayName: string
  avatarUrl: string | null
}

export type SolutionReference = {
  label: string
  /**
   * `/` 로 시작하면 사이트 안의 주소다(알렌 문서, 강의록 문서). 그렇지 않으면
   * `<bucket>/<path>` 형태의 저장소 경로이며, 강의록을 문서로 등록하기 전에
   * 풀이마다 올리던 파일들이 그렇다. 그 파일들도 계속 열려야 해서 둘을 함께 받는다.
   */
  url: string | null
  kind?: 'theory' | 'lecture'
  /** 강의록 문서에서 가리키는 쪽. 없으면 첫 쪽부터 연다. */
  page?: number | null
}

export type Solution = {
  id: string
  questionId: string | null
  groupId: string | null
  author: Author
  content: RichDoc
  references: SolutionReference[]
  isVerified: boolean
  upvoteCount: number
  createdAt: string
  editedAt: string | null
  /** 내가 추천했는지 */
  upvoted: boolean
  /** 이 풀이를 읽는 데 필요한 권한. null 이면 전체공개다. */
  requiredPermission: string | null
}

export type SolutionSort = 'top' | 'recent'

const AUTHOR_SELECT = 'profiles!solutions_author_id_fkey (id, display_name, avatar_url)'

type AuthorRow = { id: string; display_name: string; avatar_url: string | null } | null

type SolutionRow = {
  id: string
  question_id: string | null
  group_id: string | null
  author_id: string
  content: unknown
  references: unknown
  is_verified: boolean
  upvote_count: number
  created_at: string
  edited_at: string | null
  required_permission: string | null
  profiles: AuthorRow
}

export function toAuthor(row: AuthorRow, fallbackId: string): Author {
  return {
    id: row?.id ?? fallbackId,
    // 탈퇴 등으로 프로필이 비면 화면이 비지 않도록 대체 문구를 쓴다.
    displayName: row?.display_name ?? '알 수 없음',
    avatarUrl: row?.avatar_url ?? null,
  }
}

export function parseReferences(value: unknown): SolutionReference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    if (label === '') return []
    const url = typeof record.url === 'string' && record.url.trim() !== '' ? record.url.trim() : null
    const kind = record.kind === 'lecture' ? 'lecture' as const : 'theory' as const
    const rawPage = typeof record.page === 'number' ? Math.floor(record.page) : null
    const page = rawPage && rawPage > 0 ? rawPage : null
    return [{ label, url, kind, page }]
  })
}

function toSolution(row: SolutionRow, upvoted: Set<string>): Solution {
  return {
    id: row.id,
    questionId: row.question_id,
    groupId: row.group_id,
    author: toAuthor(row.profiles, row.author_id),
    content: parseRichDoc(row.content),
    references: parseReferences(row.references),
    isVerified: row.is_verified,
    upvoteCount: row.upvote_count,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    upvoted: upvoted.has(row.id),
    requiredPermission: row.required_permission,
  }
}

export async function fetchSolutions(
  target: SolutionTarget,
  sort: SolutionSort = 'top',
): Promise<Solution[]> {
  let query = supabase
    .from('solutions')
    .select(
      `id, question_id, group_id, author_id, content, references, is_verified,
       upvote_count, created_at, edited_at, required_permission, ${AUTHOR_SELECT}`,
    )

  query = target.groupId
    ? query.or(`group_id.eq.${target.groupId},question_id.eq.${target.questionId}`)
    : query.eq('question_id', target.questionId)

  const { data, error } =
    sort === 'top'
      ? await query
          .order('upvote_count', { ascending: false })
          .order('created_at', { ascending: false })
      : await query.order('created_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as unknown as SolutionRow[]
  const upvoted = await fetchMyUpvotes(rows.map((row) => row.id))
  return rows.map((row) => toSolution(row, upvoted))
}

/** 정답 공개 직후 비어 있지 않은 탭을 고를 때 쓰는 가벼운 존재 여부 조회. */
export async function hasSolutions(target: SolutionTarget): Promise<boolean> {
  let query = supabase.from('solutions').select('id').limit(1)

  query = target.groupId
    ? query.or(`group_id.eq.${target.groupId},question_id.eq.${target.questionId}`)
    : query.eq('question_id', target.questionId)

  const { data, error } = await query
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/**
 * 인쇄용. 여러 문제에 달린 풀이를 한 번에 받아 문제 id 별로 묶는다.
 * 그룹에 달린 풀이는 그 그룹에 속한 모든 문제에 붙여준다.
 */
export async function fetchSolutionsForQuestions(
  targets: { questionId: string; groupId: string | null }[],
): Promise<Map<string, Solution[]>> {
  if (targets.length === 0) return new Map()

  const questionIds = targets.map((item) => item.questionId)
  const groupIds = targets.flatMap((item) => (item.groupId ? [item.groupId] : []))

  const filters = [`question_id.in.(${questionIds.join(',')})`]
  if (groupIds.length > 0) filters.push(`group_id.in.(${groupIds.join(',')})`)

  const { data, error } = await supabase
    .from('solutions')
    .select(
      `id, question_id, group_id, author_id, content, references, is_verified,
       upvote_count, created_at, edited_at, required_permission, ${AUTHOR_SELECT}`,
    )
    .or(filters.join(','))
    .order('upvote_count', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as unknown as SolutionRow[]
  const result = new Map<string, Solution[]>()

  for (const target of targets) {
    const matched = rows
      .filter(
        (row) =>
          row.question_id === target.questionId ||
          (target.groupId !== null && row.group_id === target.groupId),
      )
      .map((row) => toSolution(row, new Set()))
    if (matched.length > 0) result.set(target.questionId, matched)
  }
  return result
}

async function fetchMyUpvotes(solutionIds: string[]): Promise<Set<string>> {
  if (solutionIds.length === 0) return new Set()
  // RLS 로 본인 행만 걸러지지 않으므로 user_id 조건은 호출 측에서 넣지 않는다.
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return new Set()

  const { data: rows, error: queryError } = await supabase
    .from('solution_upvotes')
    .select('solution_id')
    .eq('user_id', data.user.id)
    .in('solution_id', solutionIds)

  if (queryError) {
    console.error('추천 상태를 불러오지 못했습니다.', queryError)
    return new Set()
  }
  return new Set((rows ?? []).map((row) => row.solution_id))
}

export async function createSolution(params: {
  target: SolutionTarget
  authorId: string
  content: RichDoc
  references: SolutionReference[]
  /** null 이면 전체공개. 컬럼 기본값에 기대지 않고 항상 명시해서 보낸다. */
  requiredPermission: string | null
}): Promise<string> {
  const { data, error } = await supabase
    .from('solutions')
    .insert({
      // 그룹이 있으면 그룹에 달아 같은 문제 전체에서 보이게 한다.
      group_id: params.target.groupId,
      question_id: params.target.groupId ? null : params.target.questionId,
      author_id: params.authorId,
      content: toJson(params.content),
      references: toJson(params.references),
      required_permission: params.requiredPermission,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function updateSolution(params: {
  id: string
  content: RichDoc
  references: SolutionReference[]
  requiredPermission: string | null
}): Promise<void> {
  const { error } = await supabase
    .from('solutions')
    .update({
      content: toJson(params.content),
      references: toJson(params.references),
      required_permission: params.requiredPermission,
    })
    .eq('id', params.id)
  if (error) throw error
}

export async function deleteSolution(id: string): Promise<void> {
  const { error } = await supabase.from('solutions').delete().eq('id', id)
  if (error) throw error
}

export async function toggleSolutionUpvote(
  solutionId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from('solution_upvotes')
      .insert({ solution_id: solutionId, user_id: userId })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('solution_upvotes')
      .delete()
      .eq('solution_id', solutionId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

// -----------------------------------------------------------------------------
// 버전 히스토리
// -----------------------------------------------------------------------------

export type SolutionRevision = {
  id: string
  editor: Author
  createdAt: string
  summary: string | null
  /** 수정 직전 본문. 트리거가 before/after 를 함께 남긴다. */
  before: RichDoc | null
  after: RichDoc | null
}

export async function fetchSolutionRevisions(solutionId: string): Promise<SolutionRevision[]> {
  const { data, error } = await supabase
    .from('revisions')
    .select(
      `id, editor_id, created_at, change_summary, diff,
       profiles!revisions_editor_id_fkey (id, display_name, avatar_url)`,
    )
    .eq('entity_type', 'solution')
    .eq('entity_id', solutionId)
    .order('created_at', { ascending: false })

  if (error) throw error

  return ((data ?? []) as unknown as {
    id: string
    editor_id: string | null
    created_at: string
    change_summary: string | null
    diff: unknown
    profiles: AuthorRow
  }[]).map((row) => {
    const diff = (row.diff ?? {}) as Record<string, unknown>
    const content = (diff.content ?? null) as Record<string, unknown> | null
    return {
      id: row.id,
      editor: toAuthor(row.profiles, row.editor_id ?? ''),
      createdAt: row.created_at,
      summary: row.change_summary,
      before: content?.before ? parseRichDoc(content.before) : null,
      after: content?.after ? parseRichDoc(content.after) : null,
    }
  })
}

// -----------------------------------------------------------------------------
// 인라인 코멘트
// -----------------------------------------------------------------------------

export type InlineComment = {
  id: string
  solutionId: string
  parentId: string | null
  author: Author
  selectedText: string | null
  anchorFrom: number | null
  anchorTo: number | null
  content: string
  status: 'open' | 'resolved'
  createdAt: string
}

export async function fetchInlineComments(solutionIds: string[]): Promise<InlineComment[]> {
  if (solutionIds.length === 0) return []

  const { data, error } = await supabase
    .from('inline_comments')
    .select(
      `id, solution_id, parent_id, author_id, selected_text, anchor_from, anchor_to,
       content, status, created_at,
       profiles!inline_comments_author_id_fkey (id, display_name, avatar_url)`,
    )
    .in('solution_id', solutionIds)
    .order('created_at', { ascending: true })

  if (error) throw error

  return ((data ?? []) as unknown as {
    id: string
    solution_id: string
    parent_id: string | null
    author_id: string
    selected_text: string | null
    anchor_from: number | null
    anchor_to: number | null
    content: string
    status: string
    created_at: string
    profiles: AuthorRow
  }[]).map((row) => ({
    id: row.id,
    solutionId: row.solution_id,
    parentId: row.parent_id,
    author: toAuthor(row.profiles, row.author_id),
    selectedText: row.selected_text,
    anchorFrom: row.anchor_from,
    anchorTo: row.anchor_to,
    content: row.content,
    status: row.status === 'resolved' ? 'resolved' : 'open',
    createdAt: row.created_at,
  }))
}

export async function createInlineComment(params: {
  solutionId: string
  authorId: string
  parentId?: string | null
  selectedText?: string | null
  anchorFrom?: number | null
  anchorTo?: number | null
  content: string
}): Promise<void> {
  const { error } = await supabase.from('inline_comments').insert({
    solution_id: params.solutionId,
    author_id: params.authorId,
    parent_id: params.parentId ?? null,
    selected_text: params.selectedText ?? null,
    anchor_from: params.anchorFrom ?? null,
    anchor_to: params.anchorTo ?? null,
    content: params.content,
  })
  if (error) throw error
}

export async function resolveInlineComment(id: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('inline_comments')
    .update({ status: 'resolved', resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteInlineComment(id: string): Promise<void> {
  const { error } = await supabase.from('inline_comments').delete().eq('id', id)
  if (error) throw error
}
