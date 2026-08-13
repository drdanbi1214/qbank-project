import { supabase } from '@/lib/supabase'
import { toAuthor, type Author } from '@/lib/queries/solutions'
import { parseRichDoc, richTextToPlain, toJson, type RichDoc } from '@/types/richtext'

export const DISCUSSION_CATEGORIES = [
  '정답이의',
  '해설질문',
  '단원분류',
  '복기오류',
  '일반',
] as const

export type DiscussionCategory = (typeof DISCUSSION_CATEGORIES)[number]

export type DiscussionSort = 'recent' | 'top' | 'replies' | 'views'

export type DiscussionListItem = {
  id: string
  title: string
  /** 목록에 한 줄로 보여주는 본문 미리보기 */
  preview: string
  author: Author
  category: DiscussionCategory
  status: 'open' | 'resolved'
  viewCount: number
  upvoteCount: number
  replyCount: number
  createdAt: string
  questionId: string | null
  questionNumber: number | null
  questionUnitId: string | null
  questionStem: string | null
  questionExamId: string | null
}

export type Discussion = DiscussionListItem & {
  content: RichDoc
  confusionPoint: string | null
  upvoted: boolean
  bookmarked: boolean
  /** 마지막으로 본문을 수정한 시각. 한 번도 수정 안 했으면 null */
  contentEditedAt: string | null
}

export type DiscussionRevision = {
  id: string
  title: string
  category: DiscussionCategory
  content: RichDoc
  confusionPoint: string | null
  editedAt: string
}

type FeedRow = {
  id: string
  question_id: string | null
  author_id: string
  category: string
  title: string
  content: unknown
  confusion_point: string | null
  status: string
  view_count: number
  upvote_count: number
  reply_count: number
  created_at: string
  question_unit_id: string | null
  question_number: number | null
  question_stem_text: string | null
  question_exam_id: string | null
  question_subject_id: string | null
  question_cohort: string | null
  content_edited_at: string | null
}

const FEED_COLUMNS =
  `id, question_id, author_id, category, title, content, confusion_point, status,
   view_count, upvote_count, reply_count, created_at,
   question_unit_id, question_number, question_stem_text, question_exam_id,
   question_subject_id, question_cohort, content_edited_at`

function toCategory(value: string): DiscussionCategory {
  return (DISCUSSION_CATEGORIES as readonly string[]).includes(value)
    ? (value as DiscussionCategory)
    : '일반'
}

function toListItem(row: FeedRow, authors: Map<string, Author>): DiscussionListItem {
  return {
    id: row.id,
    title: row.title,
    preview: richTextToPlain(parseRichDoc(row.content)),
    author: authors.get(row.author_id) ?? toAuthor(null, row.author_id),
    category: toCategory(row.category),
    status: row.status === 'resolved' ? 'resolved' : 'open',
    viewCount: row.view_count,
    upvoteCount: row.upvote_count,
    replyCount: row.reply_count,
    createdAt: row.created_at,
    questionId: row.question_id,
    questionNumber: row.question_number,
    questionUnitId: row.question_unit_id,
    questionStem: row.question_stem_text,
    questionExamId: row.question_exam_id,
  }
}

/**
 * 작성자 표시 이름은 뷰에서 임베드하지 않고 따로 받는다.
 * PostgREST 의 관계 추론은 기반 테이블에서만 확실하기 때문이다.
 */
async function fetchAuthors(ids: string[]): Promise<Map<string, Author>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()

  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', unique)

  if (error) {
    console.error('작성자 정보를 불러오지 못했습니다.', error)
    return new Map()
  }
  return new Map((data ?? []).map((row) => [row.id, toAuthor(row, row.id)]))
}

export type DiscussionFilter = {
  questionId?: string
  category?: DiscussionCategory | null
  status?: 'open' | 'resolved' | null
  subjectId?: string | null
  cohort?: string | null
  /** 문제가 연결된 글만 */
  linkedOnly?: boolean
  sort?: DiscussionSort
  limit?: number
}

const SORT_COLUMN: Record<DiscussionSort, string> = {
  recent: 'created_at',
  top: 'upvote_count',
  replies: 'reply_count',
  views: 'view_count',
}

export async function fetchDiscussions(
  filter: DiscussionFilter = {},
): Promise<DiscussionListItem[]> {
  let query = supabase.from('discussions_feed').select(FEED_COLUMNS)

  if (filter.questionId) query = query.eq('question_id', filter.questionId)
  if (filter.category) query = query.eq('category', filter.category)
  if (filter.status) query = query.eq('status', filter.status)
  if (filter.subjectId) query = query.eq('question_subject_id', filter.subjectId)
  if (filter.cohort) query = query.eq('question_cohort', filter.cohort)
  if (filter.linkedOnly) query = query.not('question_id', 'is', null)

  const sort = filter.sort ?? 'recent'
  query = query.order(SORT_COLUMN[sort], { ascending: false })
  // 추천순, 댓글순은 값이 같은 글이 많아 최신순을 2차 기준으로 둔다.
  if (sort !== 'recent') query = query.order('created_at', { ascending: false })

  const defaultLimit = filter.category === '정답이의' ? 1000 : 50
  const { data, error } = await query.limit(filter.limit ?? defaultLimit)
  if (error) throw error

  const rows = (data ?? []) as unknown as FeedRow[]
  const authors = await fetchAuthors(rows.map((row) => row.author_id))
  return rows.map((row) => toListItem(row, authors))
}

export async function fetchDiscussion(id: string, userId: string): Promise<Discussion | null> {
  const { data, error } = await supabase
    .from('discussions_feed')
    .select(FEED_COLUMNS)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as unknown as FeedRow
  const [authors, upvoted, bookmarked] = await Promise.all([
    fetchAuthors([row.author_id]),
    hasRow('discussion_upvotes', 'discussion_id', id, userId),
    hasRow('discussion_bookmarks', 'discussion_id', id, userId),
  ])

  return {
    ...toListItem(row, authors),
    content: parseRichDoc(row.content),
    confusionPoint: row.confusion_point,
    upvoted,
    bookmarked,
    contentEditedAt: row.content_edited_at,
  }
}

async function hasRow(
  table: 'discussion_upvotes' | 'discussion_bookmarks',
  column: 'discussion_id',
  id: string,
  userId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: 'exact', head: true })
    .eq(column, id)
    .eq('user_id', userId)

  if (error) {
    console.error('상태를 불러오지 못했습니다.', error)
    return false
  }
  return (count ?? 0) > 0
}

export async function createDiscussion(params: {
  authorId: string
  questionId: string | null
  category: DiscussionCategory
  title: string
  content: RichDoc
  confusionPoint: string | null
}): Promise<string> {
  const { data, error } = await supabase
    .from('discussions')
    .insert({
      author_id: params.authorId,
      question_id: params.questionId,
      category: params.category,
      title: params.title,
      content: toJson(params.content),
      confusion_point: params.confusionPoint,
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

/**
 * 수정하기 전 상태를 revision 으로 남긴 뒤 새 내용으로 덮어쓴다.
 * content_edited_at 을 이 함수에서만 채워서, "수정됨" 표시가 조회수/댓글수
 * 증가 같은 다른 변경과 섞이지 않게 한다.
 */
export async function updateDiscussion(params: {
  id: string
  category: DiscussionCategory
  title: string
  content: RichDoc
  confusionPoint: string | null
}): Promise<void> {
  const { data: current, error: fetchError } = await supabase
    .from('discussions')
    .select('title, category, content, confusion_point')
    .eq('id', params.id)
    .single()
  if (fetchError) throw fetchError

  const { error: revisionError } = await supabase.from('discussion_revisions').insert({
    discussion_id: params.id,
    title: current.title,
    category: current.category,
    content: current.content,
    confusion_point: current.confusion_point,
  })
  if (revisionError) throw revisionError

  const { error } = await supabase
    .from('discussions')
    .update({
      category: params.category,
      title: params.title,
      content: toJson(params.content),
      confusion_point: params.confusionPoint,
      content_edited_at: new Date().toISOString(),
    })
    .eq('id', params.id)
  if (error) throw error
}

export async function fetchDiscussionRevisions(discussionId: string): Promise<DiscussionRevision[]> {
  const { data, error } = await supabase
    .from('discussion_revisions')
    .select('id, title, category, content, confusion_point, edited_at')
    .eq('discussion_id', discussionId)
    .order('edited_at', { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    category: toCategory(row.category),
    content: parseRichDoc(row.content),
    confusionPoint: row.confusion_point,
    editedAt: row.edited_at,
  }))
}

export async function deleteDiscussion(id: string): Promise<void> {
  const { error } = await supabase.from('discussions').delete().eq('id', id)
  if (error) throw error
}

export async function toggleDiscussionUpvote(
  discussionId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from('discussion_upvotes')
      .insert({ discussion_id: discussionId, user_id: userId })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('discussion_upvotes')
      .delete()
      .eq('discussion_id', discussionId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

export async function toggleDiscussionBookmark(
  discussionId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from('discussion_bookmarks')
      .insert({ discussion_id: discussionId, user_id: userId })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('discussion_bookmarks')
      .delete()
      .eq('discussion_id', discussionId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

/** 세션당 한 번만 올린다. 같은 글을 다시 열어도 중복으로 세지 않는다. */
const viewedInSession = new Set<string>()

export async function markDiscussionViewed(id: string): Promise<boolean> {
  if (viewedInSession.has(id)) return false
  viewedInSession.add(id)

  const { error } = await supabase.rpc('increment_discussion_view', { p_discussion_id: id })
  if (error) {
    console.error('조회수를 올리지 못했습니다.', error)
    return false
  }
  return true
}

// -----------------------------------------------------------------------------
// 댓글 (2단계까지)
// -----------------------------------------------------------------------------

export type Reply = {
  id: string
  parentId: string | null
  author: Author
  content: RichDoc
  isAccepted: boolean
  isDeleted: boolean
  upvoteCount: number
  createdAt: string
  upvoted: boolean
  children: Reply[]
}

export async function fetchReplies(discussionId: string, userId: string): Promise<Reply[]> {
  const { data, error } = await supabase
    .from('discussion_replies')
    .select(
      `id, parent_id, author_id, content, is_accepted, is_deleted, upvote_count, created_at,
       profiles!discussion_replies_author_id_fkey (id, display_name, avatar_url)`,
    )
    .eq('discussion_id', discussionId)
    .order('created_at', { ascending: true })

  if (error) throw error

  const rows = (data ?? []) as unknown as {
    id: string
    parent_id: string | null
    author_id: string
    content: unknown
    is_accepted: boolean
    is_deleted: boolean
    upvote_count: number
    created_at: string
    profiles: { id: string; display_name: string; avatar_url: string | null } | null
  }[]

  const myUpvotes = await fetchMyReplyUpvotes(rows.map((row) => row.id), userId)

  const byId = new Map<string, Reply>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      author: toAuthor(row.profiles, row.author_id),
      content: parseRichDoc(row.content),
      isAccepted: row.is_accepted,
      isDeleted: row.is_deleted,
      upvoteCount: row.upvote_count,
      createdAt: row.created_at,
      upvoted: myUpvotes.has(row.id),
      children: [],
    })
  }

  const roots: Reply[] = []
  for (const row of rows) {
    const reply = byId.get(row.id)
    if (!reply) continue
    const parent = row.parent_id ? byId.get(row.parent_id) : null
    if (parent) parent.children.push(reply)
    else roots.push(reply)
  }

  // 채택된 답변은 목록 맨 위로 올린다.
  roots.sort((a, b) => Number(b.isAccepted) - Number(a.isAccepted))
  return roots
}

async function fetchMyReplyUpvotes(ids: string[], userId: string): Promise<Set<string>> {
  if (ids.length === 0 || !userId) return new Set()
  const { data, error } = await supabase
    .from('reply_upvotes')
    .select('reply_id')
    .eq('user_id', userId)
    .in('reply_id', ids)

  if (error) {
    console.error('댓글 추천 상태를 불러오지 못했습니다.', error)
    return new Set()
  }
  return new Set((data ?? []).map((row) => row.reply_id))
}

export async function createReply(params: {
  discussionId: string
  authorId: string
  parentId: string | null
  content: RichDoc
}): Promise<void> {
  const { error } = await supabase.from('discussion_replies').insert({
    discussion_id: params.discussionId,
    author_id: params.authorId,
    parent_id: params.parentId,
    content: toJson(params.content),
  })
  if (error) throw error
}

export async function updateReply(id: string, content: RichDoc): Promise<void> {
  const { error } = await supabase.from('discussion_replies').update({ content: toJson(content) }).eq('id', id)
  if (error) throw error
}

export async function deleteReply(id: string): Promise<void> {
  // 대댓글이 달린 댓글은 트리거가 물리삭제 대신 is_deleted 로 바꾼다.
  const { error } = await supabase.from('discussion_replies').delete().eq('id', id)
  if (error) throw error
}

export async function toggleReplyUpvote(
  replyId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from('reply_upvotes')
      .insert({ reply_id: replyId, user_id: userId })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('reply_upvotes')
      .delete()
      .eq('reply_id', replyId)
      .eq('user_id', userId)
    if (error) throw error
  }
}

/** 답변 채택. 하나만 유지하고 글 상태를 resolved 로 바꾼다. */
export async function acceptReply(params: {
  discussionId: string
  replyId: string
  userId: string
}): Promise<void> {
  const { error: clearError } = await supabase
    .from('discussion_replies')
    .update({ is_accepted: false })
    .eq('discussion_id', params.discussionId)
    .eq('is_accepted', true)
  if (clearError) throw clearError

  const { error } = await supabase
    .from('discussion_replies')
    .update({ is_accepted: true })
    .eq('id', params.replyId)
  if (error) throw error

  const { error: statusError } = await supabase
    .from('discussions')
    .update({ status: 'resolved', resolved_by: params.userId })
    .eq('id', params.discussionId)
  if (statusError) throw statusError
}
