import { supabase } from '@/lib/supabase'

/**
 * 강의록 라이브러리.
 *
 * 강의록은 이론(theory_documents)과 달리 본문을 사이트에서 쓰지 않는다. PDF 원본
 * 한 부를 두고 화면에서 그대로 읽는다. text_content 는 화면에 뿌리지 않고 문서 간
 * 검색에만 쓰므로 목록 조회에서는 일부러 빼서 받는다 — 수백 건이면 본문까지 끌고
 * 오는 순간 목록이 몇 MB 가 된다.
 *
 * 분류는 임상 과목(subjects)이 아니라 강의록 전용 lecture_categories 를 쓴다.
 */
export type LectureCategory = {
  id: string
  name: string
  sortOrder: number
  /** 그 분류에 담긴 강의록 수. 목록에서 바로 보여 주려고 함께 센다. */
  documentCount: number
}

export type LectureDocument = {
  id: string
  categoryId: string
  title: string
  professor: string | null
  curriculum: string | null
  lectureYear: number | null
  filePath: string
  byteSize: number | null
  pageCount: number | null
  isPublished: boolean
  requiredPermission: string | null
  updatedAt: string
  /** 본문 검색일 때 처음 일치한 쪽과 주변 문맥. 일반 목록에서는 null이다. */
  matchPage: number | null
  matchSnippet: string | null
  matchPageCount: number
}

const LIST_SELECT =
  'id, category_id, title, professor, curriculum, lecture_year, file_path, byte_size, page_count, is_published, required_permission, updated_at'

type LectureRow = {
  id: string
  category_id: string
  title: string
  professor: string | null
  curriculum: string | null
  lecture_year: number | null
  file_path: string
  byte_size: number | null
  page_count: number | null
  is_published: boolean
  required_permission: string | null
  updated_at: string
  match_page?: number | null
  match_snippet?: string | null
  match_page_count?: number | null
}

function toLecture(row: LectureRow): LectureDocument {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    professor: row.professor,
    curriculum: row.curriculum,
    lectureYear: row.lecture_year,
    filePath: row.file_path,
    byteSize: row.byte_size,
    pageCount: row.page_count,
    isPublished: row.is_published,
    requiredPermission: row.required_permission,
    updatedAt: row.updated_at,
    matchPage: row.match_page ?? null,
    matchSnippet: row.match_snippet ?? null,
    matchPageCount: row.match_page_count ?? 0,
  }
}

/** 분류 목록. 빈 분류도 보여야 해서 문서 쪽에서 세지 않고 분류에서 끌고 온다. */
export async function fetchLectureCategories(): Promise<LectureCategory[]> {
  const { data, error } = await supabase
    .from('lecture_categories')
    .select('id, name, sort_order, lecture_documents(count)')
    .order('sort_order')
    .order('name')
  if (error) throw error

  type Row = {
    id: string
    name: string
    sort_order: number
    lecture_documents: { count: number }[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    documentCount: row.lecture_documents?.[0]?.count ?? 0,
  }))
}

export async function createLectureCategory(name: string): Promise<void> {
  const { error } = await supabase.from('lecture_categories').insert({ name: name.trim() })
  if (error) throw error
}

export async function renameLectureCategory(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('lecture_categories')
    .update({ name: name.trim() })
    .eq('id', id)
  if (error) throw error
}

/** 강의록이 남아 있으면 DB 의 참조 제약이 막는다. 빈 분류만 지워진다. */
export async function deleteLectureCategory(id: string): Promise<void> {
  const { error } = await supabase.from('lecture_categories').delete().eq('id', id)
  if (error) throw error
}

export type LectureFilter = {
  categoryId?: string | null
  professor?: string | null
  year?: number | null
  /** 제목과 본문에서 함께 찾는다. 본문 색인은 트라이그램이라 부분 문자열도 걸린다. */
  keyword?: string
}

export async function fetchLectureDocuments(filter: LectureFilter = {}): Promise<LectureDocument[]> {
  const keyword = filter.keyword?.trim() ?? ''
  if (keyword) {
    const { data, error } = await supabase.rpc('search_lecture_documents', {
      p_query: keyword,
      p_category_id: filter.categoryId ?? undefined,
      p_professor: filter.professor ?? undefined,
      p_year: filter.year ?? undefined,
      p_limit: 200,
    })
    if (error) throw error
    return ((data ?? []) as LectureRow[]).map(toLecture)
  }

  let query = supabase
    .from('lecture_documents')
    .select(LIST_SELECT)
    .order('lecture_year', { ascending: false, nullsFirst: false })
    .order('professor', { nullsFirst: false })
    .order('sort_order')
    .order('title')

  if (filter.categoryId) query = query.eq('category_id', filter.categoryId)
  if (filter.professor) query = query.eq('professor', filter.professor)
  if (filter.year) query = query.eq('lecture_year', filter.year)

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as LectureRow[]).map(toLecture)
}

export async function fetchLectureDocument(id: string): Promise<LectureDocument | null> {
  const { data, error } = await supabase
    .from('lecture_documents')
    .select(LIST_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? toLecture(data as LectureRow) : null
}

/**
 * 목록 위의 거르개를 채울 값들. 실제로 등록된 것만 보여주려고 행에서 직접 뽑는다.
 * 교수가 110명이라 고정 목록을 코드에 둘 수 없다.
 */
export async function fetchLectureFacets(categoryId?: string | null): Promise<{
  professors: string[]
  years: number[]
}> {
  let query = supabase.from('lecture_documents').select('professor, lecture_year')
  if (categoryId) query = query.eq('category_id', categoryId)

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as { professor: string | null; lecture_year: number | null }[]
  const professors = [...new Set(rows.map((row) => row.professor).filter((v): v is string => !!v))]
  const years = [...new Set(rows.map((row) => row.lecture_year).filter((v): v is number => !!v))]

  professors.sort((a, b) => a.localeCompare(b, 'ko'))
  years.sort((a, b) => b - a)
  return { professors, years }
}

/**
 * 본문에 박힌 강의록 쪽을 훑어 참조 목록으로 만든다.
 *
 * 글 가운데 강의록을 넣고 나서 아래 "관련 단원" 에서 같은 강의록을 다시 찾게
 * 하면 같은 일을 두 번 시키는 셈이다. 본문에 넣는 순간 참조에도 잡히게 한다.
 * 같은 강의록을 여러 쪽 넣었으면 가장 앞 쪽 하나만 남긴다 — 참조는 "이 강의록을
 * 봤다" 는 표시라 쪽마다 줄이 늘어날 필요가 없다.
 */
export function collectLectureReferences(
  doc: unknown,
): { label: string; url: string; kind: 'lecture'; page: number | null }[] {
  const found = new Map<string, { label: string; url: string; kind: 'lecture'; page: number | null }>()

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>

    if (record.type === 'lecturePageEmbed') {
      const attrs = (record.attrs ?? {}) as Record<string, unknown>
      const lectureId = typeof attrs.lectureId === 'string' ? attrs.lectureId : null
      if (lectureId) {
        const url = `/lectures/${lectureId}`
        const page = typeof attrs.page === 'number' ? attrs.page : null
        const title = typeof attrs.title === 'string' ? attrs.title : '강의록'
        const professor = typeof attrs.professor === 'string' ? attrs.professor : null
        const existing = found.get(url)
        // 더 앞쪽을 만나면 그쪽으로 바꾼다.
        if (!existing || (page !== null && (existing.page === null || page < existing.page))) {
          found.set(url, {
            label: [title, professor].filter(Boolean).join(' · '),
            url,
            kind: 'lecture',
            page,
          })
        }
      }
    }

    const content = record.content
    if (Array.isArray(content)) for (const child of content) walk(child)
  }

  walk(doc)
  return [...found.values()]
}
