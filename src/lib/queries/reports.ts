import { supabase } from '@/lib/supabase'

export type ReportTarget = 'question' | 'solution' | 'comment' | 'discussion'

export async function submitReport(params: {
  reporterId: string
  targetType: ReportTarget
  targetId: string
  reason: string
}): Promise<void> {
  const { error } = await supabase.from('reports').insert({
    reporter_id: params.reporterId,
    target_type: params.targetType,
    target_id: params.targetId,
    reason: params.reason,
  })
  if (error) throw error
}
