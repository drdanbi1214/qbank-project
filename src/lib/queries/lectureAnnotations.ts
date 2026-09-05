import type { PageMark } from '@/components/lecture/pageMarks'
import { parsePageMarks } from '@/components/lecture/pageMarks'
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

export type LecturePdfAnnotations = Record<number, PageMark[]>

export type LecturePdfAnnotationSnapshot = {
  pages: LecturePdfAnnotations
  revisions: Record<number, number>
  updatedAt: Record<number, string>
}

export type SaveLecturePdfAnnotationsResult =
  | { status: 'saved'; marks: PageMark[]; revision: number; updatedAt: string }
  | { status: 'conflict'; marks: PageMark[]; revision: number | null; updatedAt: string | null }

/** 로그인한 사용자가 이 강의록에 남긴 필기만 가져온다. */
export async function fetchLecturePdfAnnotations(params: {
  userId: string
  lectureId: string
}): Promise<LecturePdfAnnotationSnapshot> {
  const { data, error } = await supabase
    .from('lecture_pdf_annotations')
    .select('page_number, marks, revision, updated_at')
    .eq('user_id', params.userId)
    .eq('lecture_id', params.lectureId)
    .order('page_number')

  if (error) throw error

  const pages: LecturePdfAnnotations = {}
  const revisions: Record<number, number> = {}
  const updatedAt: Record<number, string> = {}
  for (const row of data ?? []) {
    const marks = parsePageMarks(row.marks)
    if (marks.length > 0) pages[row.page_number] = marks
    revisions[row.page_number] = row.revision
    updatedAt[row.page_number] = row.updated_at
  }
  return { pages, revisions, updatedAt }
}

/** 읽었던 revision과 서버 revision이 같을 때만 한 페이지 전체를 저장한다. */
export async function saveLecturePdfAnnotations(params: {
  lectureId: string
  pageNumber: number
  marks: PageMark[]
  expectedRevision: number | null
}): Promise<SaveLecturePdfAnnotationsResult> {
  const { data, error } = await supabase.rpc('save_lecture_pdf_annotations', {
    p_lecture_id: params.lectureId,
    p_page_number: params.pageNumber,
    p_marks: params.marks as unknown as Json,
    p_expected_revision: params.expectedRevision,
  })

  if (error) throw error
  const row = data?.[0]
  if (!row || (row.save_status !== 'saved' && row.save_status !== 'conflict')) {
    throw new Error('필기 저장 결과를 확인하지 못했습니다.')
  }
  const marks = parsePageMarks(row.server_marks)
  if (row.save_status === 'conflict') {
    return {
      status: 'conflict',
      marks,
      revision: row.server_revision,
      updatedAt: row.server_updated_at,
    }
  }
  if (row.server_revision === null || row.server_updated_at === null) {
    throw new Error('저장된 필기의 수정 번호를 확인하지 못했습니다.')
  }
  return {
    status: 'saved',
    marks,
    revision: row.server_revision,
    updatedAt: row.server_updated_at,
  }
}
