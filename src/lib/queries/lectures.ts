import { supabase } from '@/lib/supabase'

/**
 * 강의록 라이브러리.
 *
 * 강의록은 이론(theory_documents)과 달리 본문을 사이트에서 쓰지 않는다. PDF 원본
 * 한 부를 두고 화면에서 그대로 읽는다. text_content 는 화면에 뿌리지 않고 문서 간
 * 검색에만 쓰므로 목록 조회에서는 일부러 빼서 받는다 — 수백 건이면 본문까지 끌고
 * 오는 순간 목록이 몇 MB 가 된다.
 */
export type LectureDocument = {
  id: string
  subjectId: string
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
}

const LIST_SELECT =
  'id, subject_id, title, professor, curriculum, lecture_year, file_path, byte_size, page_count, is_published, required_permission, updated_at'

type LectureRow = {
  id: string
  subject_id: string
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
}

function toLecture(row: LectureRow): LectureDocument {
  return {
    id: row.id,
    subjectId: row.subject_id,
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
  }
}

export type LectureFilter = {
  subjectId?: string | null
  professor?: string | null
  year?: number | null
  /** 제목과 본문에서 함께 찾는다. 본문 색인은 트라이그램이라 부분 문자열도 걸린다. */
  keyword?: string
}

export async function fetchLectureDocuments(filter: LectureFilter = {}): Promise<LectureDocument[]> {
  let query = supabase
    .from('lecture_documents')
    .select(LIST_SELECT)
    .order('lecture_year', { ascending: false, nullsFirst: false })
    .order('professor', { nullsFirst: false })
    .order('sort_order')
    .order('title')

  if (filter.subjectId) query = query.eq('subject_id', filter.subjectId)
  if (filter.professor) query = query.eq('professor', filter.professor)
  if (filter.year) query = query.eq('lecture_year', filter.year)

  const keyword = filter.keyword?.trim()
  if (keyword) {
    // 쉼표와 괄호는 PostgREST 의 or() 문법을 깨뜨리므로 미리 걸러낸다.
    const safe = keyword.replace(/[,()]/g, ' ').trim()
    if (safe) query = query.or(`title.ilike.%${safe}%,text_content.ilike.%${safe}%`)
  }

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
export async function fetchLectureFacets(subjectId?: string | null): Promise<{
  professors: string[]
  years: number[]
}> {
  let query = supabase.from('lecture_documents').select('professor, lecture_year')
  if (subjectId) query = query.eq('subject_id', subjectId)

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as { professor: string | null; lecture_year: number | null }[]
  const professors = [...new Set(rows.map((row) => row.professor).filter((v): v is string => !!v))]
  const years = [...new Set(rows.map((row) => row.lecture_year).filter((v): v is number => !!v))]

  professors.sort((a, b) => a.localeCompare(b, 'ko'))
  years.sort((a, b) => b - a)
  return { professors, years }
}
