import { supabase } from '@/lib/supabase'

/** 이 계정이 특정 업데이트 안내를 영구적으로 숨겼는지 확인한다. */
export async function isUpdateNoticeDismissed(
  userId: string,
  noticeKey: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('update_notice_dismissals')
    .select('notice_key')
    .eq('user_id', userId)
    .eq('notice_key', noticeKey)
    .maybeSingle()

  if (error) throw error
  return data !== null
}

/** 한 번 숨긴 업데이트 안내는 계정의 다른 기기에서도 다시 띄우지 않는다. */
export async function dismissUpdateNotice(userId: string, noticeKey: string): Promise<void> {
  const { error } = await supabase.from('update_notice_dismissals').insert({
    user_id: userId,
    notice_key: noticeKey,
  })

  // 여러 탭에서 동시에 닫았을 때의 중복 행은 이미 저장된 것과 같으므로 성공이다.
  if (error && error.code !== '23505') throw error
}
