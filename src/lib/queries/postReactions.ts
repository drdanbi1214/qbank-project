import { supabase } from '@/lib/supabase'
import { toAuthor, type Author } from '@/lib/queries/solutions'
import { parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

/**
 * 공지와 테마의 추천·댓글.
 *
 * 두 곳은 표만 다르고 구조가 같다. 접근 범위는 각 표의 RLS 가 원글의
 * required_permission 을 그대로 상속하므로 여기서 따로 거르지 않는다.
 *
 * supabase-js 는 from() 에 유니온을 넘기면 반환 타입을 좁히지 못한다.
 * 그래서 표 이름은 분기해서 리터럴로 넘기고, 결과를 다루는 부분만 공유한다.
 */
export type PostTarget = {
  kind: 'announcement' | 'topic'
  id: string
}

const COMMENT_COLUMNS = 'id, parent_id, author_id, content, is_deleted, created_at'
const AUTHOR_JOIN = '(id, display_name, avatar_url)'

type CommentRow = {
  id: string
  parent_id: string | null
  author_id: string
  content: unknown
  is_deleted: boolean
  created_at: string
  profiles: { id: string; display_name: string; avatar_url: string | null } | null
}

export type PostComment = {
  id: string
  parentId: string | null
  author: Author
  content: RichDoc
  isDeleted: boolean
  createdAt: string
  children: PostComment[]
}

/** 목록에 있는 글들 중 내가 추천한 것들. */
export async function fetchMyUpvotes(
  kind: PostTarget['kind'],
  ids: string[],
  userId: string,
): Promise<Set<string>> {
  if (ids.length === 0 || !userId) return new Set()

  const result =
    kind === 'announcement'
      ? await supabase
          .from('announcement_upvotes')
          .select('announcement_id')
          .eq('user_id', userId)
          .in('announcement_id', ids)
      : await supabase
          .from('topic_upvotes')
          .select('topic_id')
          .eq('user_id', userId)
          .in('topic_id', ids)

  if (result.error) {
    // 추천 표시가 없다고 본문까지 못 보게 할 이유는 없다.
    console.error('추천 상태를 불러오지 못했습니다.', result.error)
    return new Set()
  }
  return new Set(
    (result.data ?? []).map((row) =>
      'announcement_id' in row ? row.announcement_id : row.topic_id,
    ),
  )
}

/** 추천을 켜고 끈다. 알림은 DB 트리거가 보내며 껐다 켜도 한 번만 간다. */
export async function togglePostUpvote(
  target: PostTarget,
  userId: string,
  on: boolean,
): Promise<void> {
  if (target.kind === 'announcement') {
    const { error } = on
      ? await supabase
          .from('announcement_upvotes')
          .insert({ announcement_id: target.id, user_id: userId })
      : await supabase
          .from('announcement_upvotes')
          .delete()
          .eq('announcement_id', target.id)
          .eq('user_id', userId)
    if (error) throw error
    return
  }

  const { error } = on
    ? await supabase.from('topic_upvotes').insert({ topic_id: target.id, user_id: userId })
    : await supabase
        .from('topic_upvotes')
        .delete()
        .eq('topic_id', target.id)
        .eq('user_id', userId)
  if (error) throw error
}

export async function fetchPostComments(target: PostTarget): Promise<PostComment[]> {
  const result =
    target.kind === 'announcement'
      ? await supabase
          .from('announcement_comments')
          .select(`${COMMENT_COLUMNS}, profiles!announcement_comments_author_id_fkey ${AUTHOR_JOIN}`)
          .eq('announcement_id', target.id)
          .order('created_at', { ascending: true })
      : await supabase
          .from('topic_comments')
          .select(`${COMMENT_COLUMNS}, profiles!topic_comments_author_id_fkey ${AUTHOR_JOIN}`)
          .eq('topic_id', target.id)
          .order('created_at', { ascending: true })

  if (result.error) throw result.error
  return buildTree((result.data ?? []) as unknown as CommentRow[])
}

function buildTree(rows: CommentRow[]): PostComment[] {
  const byId = new Map<string, PostComment>()
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

  const roots: PostComment[] = []
  for (const row of rows) {
    const comment = byId.get(row.id)
    if (!comment) continue
    const parent = row.parent_id ? byId.get(row.parent_id) : null
    if (parent) parent.children.push(comment)
    else roots.push(comment)
  }
  return roots
}

export async function createPostComment(params: {
  target: PostTarget
  authorId: string
  parentId: string | null
  content: RichDoc
}): Promise<void> {
  const shared = {
    author_id: params.authorId,
    parent_id: params.parentId,
    content: toJson(params.content),
  }
  const { error } =
    params.target.kind === 'announcement'
      ? await supabase
          .from('announcement_comments')
          .insert({ ...shared, announcement_id: params.target.id })
      : await supabase.from('topic_comments').insert({ ...shared, topic_id: params.target.id })
  if (error) throw error
}

export async function updatePostComment(
  target: PostTarget,
  id: string,
  content: RichDoc,
): Promise<void> {
  const { error } =
    target.kind === 'announcement'
      ? await supabase
          .from('announcement_comments')
          .update({ content: toJson(content) })
          .eq('id', id)
      : await supabase.from('topic_comments').update({ content: toJson(content) }).eq('id', id)
  if (error) throw error
}

/** 답글이 달린 댓글은 DB 트리거가 내용만 비운다. */
export async function deletePostComment(target: PostTarget, id: string): Promise<void> {
  const { error } =
    target.kind === 'announcement'
      ? await supabase.from('announcement_comments').delete().eq('id', id)
      : await supabase.from('topic_comments').delete().eq('id', id)
  if (error) throw error
}
