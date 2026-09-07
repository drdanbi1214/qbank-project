import { supabase } from '@/lib/supabase'
import { toAuthor, type Author } from '@/lib/queries/solutions'
import { parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

export type NotificationType =
  | 'solution_comment'
  | 'inline_comment'
  | 'comment_reply'
  | 'mention'
  | 'solution_upvote'
  | 'assignment'
  | 'comment_resolved'
  | 'discussion_reply'
  | 'answer_accepted'
  | 'announcement'
  | 'announcement_upvote'
  | 'announcement_comment'

export type AppNotification = {
  id: string
  type: NotificationType
  actor: Author | null
  targetType: string | null
  targetId: string | null
  message: string | null
  isRead: boolean
  createdAt: string
}

export const NOTIFICATION_LABEL: Record<NotificationType, string> = {
  solution_comment: '풀이 댓글',
  inline_comment: '인라인 코멘트',
  comment_reply: '답글',
  mention: '멘션',
  solution_upvote: '풀이 추천',
  assignment: '문항 배정',
  comment_resolved: '코멘트 해결',
  discussion_reply: '게시글 댓글',
  answer_accepted: '답변 채택',
  announcement: '공지',
  announcement_upvote: '공지 추천',
  announcement_comment: '공지 댓글',
}

export async function fetchNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(
      `id, type, actor_id, target_type, target_id, message, is_read, created_at,
       profiles!notifications_actor_id_fkey (id, display_name, avatar_url)`,
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return ((data ?? []) as unknown as {
    id: string
    type: string
    actor_id: string | null
    target_type: string | null
    target_id: string | null
    message: string | null
    is_read: boolean
    created_at: string
    profiles: { id: string; display_name: string; avatar_url: string | null } | null
  }[]).map((row) => ({
    id: row.id,
    type: row.type as NotificationType,
    actor: row.actor_id ? toAuthor(row.profiles, row.actor_id) : null,
    targetType: row.target_type,
    targetId: row.target_id,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
  }))
}

export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('notifications').update({ is_read: true }).in('id', ids)
  if (error) throw error
}

export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
  if (error) throw error
}

/**
 * 알림이 가리키는 화면 경로.
 * 풀이 알림은 풀이 id 만 들고 있어서 어느 문제인지 한 번 더 조회해야 한다.
 */
export async function resolveNotificationLink(
  notification: AppNotification,
): Promise<string | null> {
  const { targetType, targetId } = notification
  if (!targetId) return targetType === 'announcement' ? '/announcements' : null

  switch (targetType) {
    case 'discussion':
      return `/discussions?post=${targetId}`
    case 'question':
      return `/solve?question=${targetId}`
    case 'announcement': {
      const { data } = await supabase
        .from('announcements')
        .select('required_permission')
        .eq('id', targetId)
        .maybeSingle()

      // 레옵스 공지는 /topics/notices 에 있다. 한쪽으로 몰면 빈 화면이 열린다.
      const path = data?.required_permission === 'study_legendob' ? '/topics/notices' : '/announcements'
      return `${path}#announcement-${targetId}`
    }
    case 'solution': {
      const { data, error } = await supabase
        .from('solutions')
        .select('question_id, group_id')
        .eq('id', targetId)
        .maybeSingle()

      if (error || !data) return null
      if (data.question_id) return `/solve?question=${data.question_id}`
      if (!data.group_id) return null

      // 그룹에 달린 풀이는 그룹의 아무 문제로 보낸다.
      const { data: question } = await supabase
        .from('questions_solve')
        .select('id')
        .eq('group_id', data.group_id)
        .limit(1)
        .maybeSingle()
      return question?.id ? `/solve?question=${question.id}` : null
    }
    default:
      return null
  }
}

// -----------------------------------------------------------------------------
// 공지사항
// -----------------------------------------------------------------------------

export type Announcement = {
  id: string
  title: string
  content: RichDoc
  isPinned: boolean
  author: Author | null
  createdAt: string
  upvoteCount: number
  commentCount: number
  /** 지금 로그인한 사람이 추천했는지 */
  upvoted: boolean
}

export type AnnouncementPreview = Pick<Announcement, 'id' | 'title' | 'content' | 'createdAt'>

/**
 * 공지사항.
 *
 * requiredPermission 을 넘기면 그 스터디의 공지만, 넘기지 않으면 전체공개
 * 공지만 가져온다. 섞이면 전체 공지 목록에 남의 스터디 공지가 끼어든다.
 */
export async function fetchAnnouncements(
  requiredPermission: string | null = null,
  userId = '',
): Promise<Announcement[]> {
  let query = supabase
    .from('announcements')
    .select(
      `id, title, content, is_pinned, author_id, created_at, upvote_count, comment_count,
       profiles!announcements_author_id_fkey (id, display_name, avatar_url)`,
    )

  query = requiredPermission
    ? query.eq('required_permission', requiredPermission)
    : query.is('required_permission', null)

  const { data, error } = await query
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw error

  const rows = (data ?? []) as unknown as {
    id: string
    title: string
    content: unknown
    is_pinned: boolean
    author_id: string | null
    created_at: string
    upvote_count: number
    comment_count: number
    profiles: { id: string; display_name: string; avatar_url: string | null } | null
  }[]

  const mine = await fetchMyAnnouncementUpvotes(rows.map((row) => row.id), userId)

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: parseRichDoc(row.content),
    isPinned: row.is_pinned,
    author: row.author_id ? toAuthor(row.profiles, row.author_id) : null,
    createdAt: row.created_at,
    upvoteCount: row.upvote_count,
    commentCount: row.comment_count,
    upvoted: mine.has(row.id),
  }))
}

/** 첫 화면 미리보기용으로 가장 최근에 작성된 공지 하나만 가져온다. */
export async function fetchLatestAnnouncement(
  requiredPermission: string | null = null,
): Promise<AnnouncementPreview | null> {
  let query = supabase
    .from('announcements')
    .select('id, title, content, created_at')

  query = requiredPermission
    ? query.eq('required_permission', requiredPermission)
    : query.is('required_permission', null)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return {
    id: data.id,
    title: data.title,
    content: parseRichDoc(data.content),
    createdAt: data.created_at,
  }
}

// -----------------------------------------------------------------------------
// 공지 추천·댓글
// -----------------------------------------------------------------------------

async function fetchMyAnnouncementUpvotes(ids: string[], userId: string): Promise<Set<string>> {
  if (ids.length === 0 || !userId) return new Set()
  const { data, error } = await supabase
    .from('announcement_upvotes')
    .select('announcement_id')
    .eq('user_id', userId)
    .in('announcement_id', ids)

  if (error) {
    // 추천 표시가 없다고 공지 목록까지 못 보게 할 이유는 없다.
    console.error('공지 추천 상태를 불러오지 못했습니다.', error)
    return new Set()
  }
  return new Set((data ?? []).map((row) => row.announcement_id))
}

/** 추천을 켜고 끈다. 알림은 DB 트리거가 보내며 껐다 켜도 한 번만 간다. */
export async function toggleAnnouncementUpvote(
  announcementId: string,
  userId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    const { error } = await supabase
      .from('announcement_upvotes')
      .insert({ announcement_id: announcementId, user_id: userId })
    if (error) throw error
    return
  }
  const { error } = await supabase
    .from('announcement_upvotes')
    .delete()
    .eq('announcement_id', announcementId)
    .eq('user_id', userId)
  if (error) throw error
}

export type AnnouncementComment = {
  id: string
  parentId: string | null
  author: Author
  content: RichDoc
  isDeleted: boolean
  createdAt: string
  children: AnnouncementComment[]
}

export async function fetchAnnouncementComments(
  announcementId: string,
): Promise<AnnouncementComment[]> {
  const { data, error } = await supabase
    .from('announcement_comments')
    .select(
      `id, parent_id, author_id, content, is_deleted, created_at,
       profiles!announcement_comments_author_id_fkey (id, display_name, avatar_url)`,
    )
    .eq('announcement_id', announcementId)
    .order('created_at', { ascending: true })

  if (error) throw error

  const rows = (data ?? []) as unknown as {
    id: string
    parent_id: string | null
    author_id: string
    content: unknown
    is_deleted: boolean
    created_at: string
    profiles: { id: string; display_name: string; avatar_url: string | null } | null
  }[]

  const byId = new Map<string, AnnouncementComment>()
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      author: toAuthor(row.profiles, row.author_id),
      content: parseRichDoc(row.content),
      isDeleted: row.is_deleted,
      createdAt: row.created_at,
      children: [],
    })
  }

  const roots: AnnouncementComment[] = []
  for (const row of rows) {
    const comment = byId.get(row.id)
    if (!comment) continue
    const parent = row.parent_id ? byId.get(row.parent_id) : null
    if (parent) parent.children.push(comment)
    else roots.push(comment)
  }
  return roots
}

export async function createAnnouncementComment(params: {
  announcementId: string
  authorId: string
  parentId: string | null
  content: RichDoc
}): Promise<void> {
  const { error } = await supabase.from('announcement_comments').insert({
    announcement_id: params.announcementId,
    author_id: params.authorId,
    parent_id: params.parentId,
    content: toJson(params.content),
  })
  if (error) throw error
}

export async function updateAnnouncementComment(id: string, content: RichDoc): Promise<void> {
  const { error } = await supabase
    .from('announcement_comments')
    .update({ content: toJson(content) })
    .eq('id', id)
  if (error) throw error
}

/** 답글이 달린 댓글은 DB 트리거가 내용만 비운다. */
export async function deleteAnnouncementComment(id: string): Promise<void> {
  const { error } = await supabase.from('announcement_comments').delete().eq('id', id)
  if (error) throw error
}

export async function createAnnouncement(params: {
  authorId: string
  title: string
  content: RichDoc
  isPinned: boolean
  /** 스터디 공지면 그 권한 키. null 이면 전체공개(관리자만 쓸 수 있다). */
  requiredPermission?: string | null
}): Promise<void> {
  const { error } = await supabase.from('announcements').insert({
    author_id: params.authorId,
    title: params.title,
    content: toJson(params.content),
    is_pinned: params.isPinned,
    required_permission: params.requiredPermission ?? null,
  })
  if (error) throw error
}

export async function updateAnnouncement(params: {
  id: string
  title: string
  content: RichDoc
  isPinned: boolean
}): Promise<void> {
  const { error } = await supabase
    .from('announcements')
    .update({
      title: params.title,
      content: toJson(params.content),
      is_pinned: params.isPinned,
    })
    .eq('id', params.id)
  if (error) throw error
}

export async function deleteAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) throw error
}
