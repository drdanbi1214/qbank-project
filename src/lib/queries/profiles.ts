import { supabase } from '@/lib/supabase'

export type Member = {
  id: string
  displayName: string
  cohort: string | null
}

export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 20

/** 가입 화면에서 쓰는 형식 검사. 서버의 CHECK 제약과 같은 기준이다. */
export function validateNickname(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length < NICKNAME_MIN || trimmed.length > NICKNAME_MAX) {
    return `닉네임은 ${NICKNAME_MIN}자 이상 ${NICKNAME_MAX}자 이하로 입력해주세요.`
  }
  if (/\s/.test(trimmed)) return '닉네임에는 공백을 넣을 수 없습니다.'
  return null
}

export async function isNicknameAvailable(name: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_display_name_available', { p_name: name })
  if (error) {
    console.error('닉네임 중복을 확인하지 못했습니다.', error)
    return true // 확인에 실패하면 서버 제약에 맡긴다
  }
  return data === true
}

export type ProfileCard = {
  id: string
  displayName: string
  avatarUrl: string | null
  oneLiner: string | null
}

export const ONE_LINER_MAX = 60

/** 프로필 보기 화면에 쓰는 전체 사용자 목록 (정지되지 않은 계정). */
export async function fetchProfileCards(): Promise<ProfileCard[]> {
  const { data, error } = await supabase.rpc('list_profile_cards')

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    oneLiner: row.one_liner,
  }))
}

/** 배정 대상으로 고를 수 있는 사용자 (정지되지 않은 계정) */
export async function fetchMembers(): Promise<Member[]> {
  const { data, error } = await supabase.rpc('admin_list_assignment_members')

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    cohort: row.cohort,
  }))
}
