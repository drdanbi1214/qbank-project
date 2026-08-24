import { supabase } from '@/lib/supabase'
import { parseRichDoc, toJson, type RichDoc } from '@/types/richtext'

export type DraftTarget = 'solution' | 'note' | 'discussion' | 'topic'

export type DraftMetadata = Record<string, unknown>

export type Draft = {
  content: RichDoc
  metadata: DraftMetadata
  updatedAt: string
}

function metadataOf(value: unknown): DraftMetadata {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as DraftMetadata)
    : {}
}

export async function fetchDraft(
  targetType: DraftTarget,
  targetKey: string,
): Promise<Draft | null> {
  const { data, error } = await supabase
    .from('drafts')
    .select('content, metadata, updated_at')
    .eq('target_type', targetType)
    .eq('target_key', targetKey)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return {
    content: parseRichDoc(data.content),
    metadata: metadataOf(data.metadata),
    updatedAt: data.updated_at,
  }
}

export async function saveDraft(params: {
  userId: string
  targetType: DraftTarget
  targetKey: string
  content: RichDoc
  metadata?: DraftMetadata
}): Promise<void> {
  const { error } = await supabase.from('drafts').upsert(
    {
      user_id: params.userId,
      target_type: params.targetType,
      target_key: params.targetKey,
      content: toJson(params.content),
      metadata: toJson(params.metadata ?? {}),
    },
    { onConflict: 'user_id,target_type,target_key' },
  )
  if (error) throw error
}

export async function deleteDraft(
  targetType: DraftTarget,
  targetKey: string,
): Promise<void> {
  const { error } = await supabase
    .from('drafts')
    .delete()
    .eq('target_type', targetType)
    .eq('target_key', targetKey)
  if (error) throw error
}
