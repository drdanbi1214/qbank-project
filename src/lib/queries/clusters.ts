import { supabase } from '@/lib/supabase'
import { parseChoices, parseStemBlocks, type Choice, type StemBlock } from '@/types/question'

/**
 * 야마 클러스터.
 *
 * 같은 문제가 여러 학번 시험에 반복 출제된다. 하나로 묶어두면 풀이를 공유하고
 * 출제 이력을 배너로 보여줄 수 있다.
 *
 *   identical  완전 동일  → 배너 한 줄로만 알린다. 내용이 같으므로 본문을 반복하지 않는다.
 *   modified   거의 비슷  → 문제 전체를 펼쳐 보여준다. 어디가 다른지 눈으로 봐야 한다.
 *
 * 쓰기는 전부 RPC 를 통한다. questions 의 UPDATE 정책이 "정지되지 않은 모든
 * 로그인 사용자" 라 넓은데, 이 정책을 조이면 문제 편집과 라벨링이 같이 막힌다.
 * 그래서 정책은 그대로 두고 묶기 경로만 권한이 걸린 함수로 좁혔다.
 */

/** DB 의 variant_type 중 클러스터에 붙은 문제가 가질 수 있는 값 */
export type VariantType = 'identical' | 'modified'

/** 대표 문제까지 포함한 전체 역할 */
export type ClusterRole = 'original' | VariantType

export function toClusterRole(value: string | null | undefined): ClusterRole {
  return value === 'identical' || value === 'modified' ? value : 'original'
}

export type ClusterSibling = {
  id: string
  examId: string
  questionNumber: number
  variantType: VariantType
  /** modified 일 때만 화면에 그린다. identical 은 배너로 끝낸다. */
  stemBlocks: StemBlock[]
  choices: Choice[]
  questionCode: string | null
  unitId: string | null
  unitSource: 'ai_suggested' | 'human_confirmed' | null
  /** 대표와 무엇이 다른지 한 줄. 없으면 기본 문구를 쓴다. */
  variantNote: string | null
}

type SiblingRow = {
  id: string | null
  exam_id: string | null
  question_number: number | null
  variant_type: string | null
  stem_blocks: unknown
  choices: unknown
  question_code: string | null
  unit_id: string | null
  unit_source: string | null
  variant_note: string | null
}

const SIBLING_SELECT =
  'id, exam_id, question_number, variant_type, stem_blocks, choices, question_code, unit_id, unit_source, variant_note'

/**
 * 같은 클러스터의 다른 문제들.
 *
 * questions_solve 뷰가 본문에서 can_view_exam 으로 거르므로, 열람 권한이 없는
 * 시험의 형제는 애초에 내려오지 않는다. 그래서 배너에 뜨는 학번 목록은 보는
 * 사람에 따라 달라진다 — 의도된 동작이다.
 */
export async function fetchClusterSiblings(
  groupId: string,
  excludeQuestionId: string,
): Promise<ClusterSibling[]> {
  const { data, error } = await supabase
    .from('questions_solve')
    .select(SIBLING_SELECT)
    .eq('group_id', groupId)
    .neq('id', excludeQuestionId)
    .order('question_number')

  if (error) throw error

  return ((data ?? []) as SiblingRow[]).flatMap((row) => {
    if (!row.id || !row.exam_id) return []
    // 대표 문제(original)는 형제 목록에 넣지 않는다. 기준이 되는 문제라
    // 배너에도 변주 카드에도 해당하지 않는다.
    if (row.variant_type !== 'identical' && row.variant_type !== 'modified') return []
    return [
      {
        id: row.id,
        examId: row.exam_id,
        questionNumber: row.question_number ?? 0,
        variantType: row.variant_type,
        stemBlocks: parseStemBlocks(row.stem_blocks),
        choices: parseChoices(row.choices),
        questionCode: row.question_code,
        unitId: row.unit_id,
        unitSource:
          row.unit_source === 'ai_suggested' || row.unit_source === 'human_confirmed'
            ? row.unit_source
            : null,
        variantNote: row.variant_note,
      },
    ]
  })
}

export type LookupResult = {
  id: string
  examId: string
  questionNumber: number
  stemBlocks: StemBlock[]
  choices: Choice[]
  questionCode: string | null
  /** 이미 다른 클러스터에 묶여 있으면 붙일 수 없다. 확인 단계에서 미리 알린다. */
  groupId: string | null
}

/**
 * 시험과 번호로 문제를 찾는다.
 *
 * 문제 번호는 학번마다 다르게 매겨지므로 시험을 특정하지 않으면 엉뚱한 문제를
 * 집는다. 26학번 내과는 학년말고사와 계통 Y1~Y8 까지 시험이 9개라 특히 그렇다.
 */
export async function findQuestionInExam(
  examId: string,
  questionNumber: number,
): Promise<LookupResult | null> {
  const { data, error } = await supabase
    .from('questions_solve')
    .select(`${SIBLING_SELECT}, group_id`)
    .eq('exam_id', examId)
    .eq('question_number', questionNumber)
    .maybeSingle()

  if (error) throw error
  if (!data?.id || !data.exam_id) return null

  const row = data as SiblingRow & { group_id: string | null }
  return {
    id: row.id as string,
    examId: row.exam_id as string,
    questionNumber: row.question_number ?? questionNumber,
    stemBlocks: parseStemBlocks(row.stem_blocks),
    choices: parseChoices(row.choices),
    questionCode: row.question_code,
    groupId: row.group_id,
  }
}

/** 검색 결과에서 고른 문제를 확인용으로 받아온다. */
export async function findQuestionById(id: string): Promise<LookupResult | null> {
  const { data, error } = await supabase
    .from('questions_solve')
    .select(`${SIBLING_SELECT}, group_id`)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data?.id || !data.exam_id) return null

  const row = data as SiblingRow & { group_id: string | null }
  return {
    id: row.id as string,
    examId: row.exam_id as string,
    questionNumber: row.question_number ?? 0,
    stemBlocks: parseStemBlocks(row.stem_blocks),
    choices: parseChoices(row.choices),
    questionCode: row.question_code,
    groupId: row.group_id,
  }
}

/** 기준 문제의 클러스터에 붙인다. 그룹이 없으면 새로 만든다. */
export async function attachToCluster(params: {
  anchorId: string
  targetId: string
  variant: VariantType
}): Promise<string> {
  const { data, error } = await supabase.rpc('cluster_attach', {
    p_anchor_id: params.anchorId,
    p_target_id: params.targetId,
    p_variant: params.variant,
  })
  if (error) throw error
  return data as string
}

/**
 * 이 문제의 클러스터를 보장한다. 없으면 혼자짜리 그룹을 만들어 돌려준다.
 *
 * 해설을 항상 그룹에 붙이기 위한 것이다. 그룹 없이 문제에 직접 붙이면 나중에
 * 다른 학번 판본을 묶어도 해설이 따라가지 않는다.
 */
export async function ensureClusterGroup(questionId: string): Promise<string> {
  const { data, error } = await supabase.rpc('cluster_ensure_group', {
    p_question_id: questionId,
  })
  if (error) throw error
  return data as string
}

/** 변주가 대표와 무엇이 다른지 한 줄 메모를 남긴다. 빈 문자열이면 지운다. */
export async function setVariantNote(questionId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('cluster_set_note', {
    p_question_id: questionId,
    p_note: note,
  })
  if (error) throw error
}

/**
 * 클러스터에서 뺀다.
 *
 * 그룹 row 는 남긴다. solutions.group_id 가 ON DELETE CASCADE 라 그룹을 지우면
 * 그 클러스터에 달린 공유 해설이 전부 같이 사라지기 때문이다.
 */
export async function detachFromCluster(questionId: string): Promise<void> {
  const { error } = await supabase.rpc('cluster_detach', { p_question_id: questionId })
  if (error) throw error
}

// -----------------------------------------------------------------------------
// 완전 동일 문제 접기
// -----------------------------------------------------------------------------

type Collapsible = { id: string; groupId: string | null; variantType: ClusterRole }

/**
 * 같은 목록 안에 들어온 완전 동일 문제를 하나만 남긴다.
 *
 * 접는 대상은 한 클러스터의 original + identical 뿐이다. modified 는 지문이
 * 달라 실제로 다시 풀 값어치가 있으므로 그대로 둔다.
 *
 * 목록에 함께 들어온 것끼리만 비교하므로, 이어풀기처럼 한 단원을 통으로 훑는
 * 화면에서 크게 줄고 시험 하나만 담는 화면에서는 사실상 아무것도 줄지 않는다.
 * 먼저 나온 문제를 남겨 호출부가 정한 순서를 지킨다.
 */
export function collapseIdentical<T extends Collapsible>(rows: T[]): T[] {
  return collapseIdenticalWithFolds(rows).kept
}

/**
 * 접기 결과와 함께, 접힌 문제들이 어느 문제 뒤로 들어갔는지 돌려준다.
 * 오답노트처럼 "다른 학번 2건이 접혔다" 를 보여줘야 하는 화면에서 쓴다.
 */
export function collapseIdenticalWithFolds<T extends Collapsible>(
  rows: T[],
): { kept: T[]; folded: Map<string, T[]> } {
  const keeperOfGroup = new Map<string, T>()
  const folded = new Map<string, T[]>()
  const kept: T[] = []

  for (const row of rows) {
    if (!row.groupId || row.variantType === 'modified') {
      kept.push(row)
      continue
    }
    const keeper = keeperOfGroup.get(row.groupId)
    if (!keeper) {
      keeperOfGroup.set(row.groupId, row)
      kept.push(row)
      continue
    }
    folded.set(keeper.id, [...(folded.get(keeper.id) ?? []), row])
  }

  return { kept, folded }
}

/** 문제 id 로 클러스터 역할을 조회한다. 목록 화면에서 접기를 적용할 때 쓴다. */
export async function fetchClusterRoles(
  ids: string[],
): Promise<Map<string, { groupId: string | null; variantType: ClusterRole }>> {
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('questions_solve')
    .select('id, group_id, variant_type')
    .in('id', ids)

  if (error) throw error

  return new Map(
    (data ?? []).flatMap((row) =>
      row.id
        ? [[row.id, { groupId: row.group_id, variantType: toClusterRole(row.variant_type) }] as const]
        : [],
    ),
  )
}

/** 개인 설정. 켜져 있으면 완전 동일 문제를 목록에서 하나만 보여준다. */
export async function fetchCollapseSetting(): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('dedupe_identical')
    .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
    .maybeSingle()

  if (error) throw error
  return data?.dedupe_identical ?? true
}

export async function setCollapseSetting(enabled: boolean): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user?.id
  if (!userId) return
  const { error } = await supabase
    .from('profiles')
    .update({ dedupe_identical: enabled })
    .eq('id', userId)
  if (error) throw error
}

/**
 * id 목록에서 완전 동일 문제를 접는다. 설정이 꺼져 있으면 그대로 돌려준다.
 *
 * 호출부가 group_id/variant_type 을 들고 있지 않을 때 쓴다. 이미 들고 있으면
 * 조회 한 번을 아끼도록 collapseIdentical 을 직접 부르면 된다.
 */
export async function collapseIdenticalIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return ids
  if (!(await fetchCollapseSetting())) return ids

  const byId = await fetchClusterRoles(ids)

  // 넘어온 순서를 지켜야 하므로 조회 결과가 아니라 원래 배열을 훑는다.
  const rows = ids.map((id) => ({
    id,
    groupId: byId.get(id)?.groupId ?? null,
    variantType: byId.get(id)?.variantType ?? ('original' as ClusterRole),
  }))

  return collapseIdentical(rows).map((row) => row.id)
}
