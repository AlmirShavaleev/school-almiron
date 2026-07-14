import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

export const TOPIC_LINK_TYPE = 'link'
export const TOPIC_LINK_KIND = 'topic-link'

export interface TopicLinkMetadata {
  kind: typeof TOPIC_LINK_KIND
  title: string
  url: string
}

export interface TopicLinkMaterialDraft {
  object_path: string
  normalized_title: string
  normalized_url: string
  metadata: TopicLinkMetadata
}

export interface TopicLinkMaterialView {
  title: string
  url: string
  path: string
}

function isTopicLinkMetadata(value: unknown): value is TopicLinkMetadata {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    row.kind === TOPIC_LINK_KIND &&
    typeof row.title === 'string' &&
    typeof row.url === 'string'
  )
}

export async function prepareTopicLinkMaterial(topicId: string, title: string, url: string): Promise<TopicLinkMaterialDraft> {
  const { data, error } = await supabase.rpc('prepare_topic_link_material', {
    p_topic_id: topicId,
    p_title: title,
    p_url: url,
  })

  if (error) throw new Error(error.message || 'Не удалось подготовить ссылку')
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.object_path || !isTopicLinkMetadata(row.metadata)) {
    throw new Error('Сервер вернул некорректные данные для ссылки')
  }

  return {
    object_path: row.object_path,
    normalized_title: row.normalized_title,
    normalized_url: row.normalized_url,
    metadata: row.metadata,
  }
}

export async function uploadTopicLinkMarker(draft: TopicLinkMaterialDraft) {
  const { error } = await supabase.storage
    .from('course-materials')
    .upload(
      draft.object_path,
      new Blob(['topic-link'], { type: 'text/plain;charset=UTF-8' }),
      {
        upsert: false,
        contentType: 'text/plain;charset=UTF-8',
        metadata: draft.metadata as unknown as Record<string, Json>,
      },
    )

  if (error) throw new Error(error.message || 'Не удалось сохранить ссылку')
}

export async function removeTopicLinkMarker(path: string) {
  const { error } = await supabase.storage.from('course-materials').remove([path])
  if (error) throw new Error(error.message || 'Не удалось удалить ссылку')
}

export async function loadTopicLinkMetadata(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)))
  if (!uniquePaths.length) return new Map<string, TopicLinkMaterialView>()

  const settled = await Promise.all(uniquePaths.map(async path => {
    const { data, error } = await supabase.storage.from('course-materials').info(path)
    if (error || !isTopicLinkMetadata(data?.metadata)) return null
    return [path, { path, title: data.metadata.title, url: data.metadata.url }] as const
  }))

  return new Map<string, TopicLinkMaterialView>(settled.filter(Boolean) as Array<readonly [string, TopicLinkMaterialView]>)
}
