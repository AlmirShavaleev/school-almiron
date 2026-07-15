import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

export const LESSON_TEMPLATE_LINK_TYPE = 'link'
export const LESSON_TEMPLATE_LINK_KIND = 'lesson-template-link'

interface LessonTemplateLinkMetadata {
  kind: typeof LESSON_TEMPLATE_LINK_KIND
  title: string
  url: string
}

export interface LessonTemplateLinkDraft {
  object_path: string
  normalized_title: string
  normalized_url: string
  metadata: LessonTemplateLinkMetadata
}

export interface LessonTemplateLinkView {
  title: string
  url: string
  path: string
}

function slugifyTitle(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'link'
}

function normalizeUrl(url: string) {
  const value = url.trim()
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function isLinkMetadata(value: unknown): value is LessonTemplateLinkMetadata {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.kind === LESSON_TEMPLATE_LINK_KIND && typeof row.title === 'string' && typeof row.url === 'string'
}

export async function prepareLessonTemplateLinkMaterial(templateId: string, title: string, url: string): Promise<LessonTemplateLinkDraft> {
  const normalized_title = title.trim()
  const normalized_url = normalizeUrl(url)
  if (!normalized_title) throw new Error('Введите название ссылки')
  if (!normalized_url) throw new Error('Введите URL')

  return {
    object_path: `owner/${(await supabase.auth.getUser()).data.user?.id ?? 'unknown'}/templates/${templateId}/link/${Date.now()}-${slugifyTitle(normalized_title)}.link`,
    normalized_title,
    normalized_url,
    metadata: {
      kind: LESSON_TEMPLATE_LINK_KIND,
      title: normalized_title,
      url: normalized_url,
    },
  }
}

export async function uploadLessonTemplateLinkMarker(draft: LessonTemplateLinkDraft) {
  const { error } = await supabase.storage
    .from('lesson-library')
    .upload(
      draft.object_path,
      new Blob(['lesson-template-link'], { type: 'text/plain;charset=UTF-8' }),
      {
        upsert: false,
        contentType: 'text/plain;charset=UTF-8',
        metadata: draft.metadata as unknown as Record<string, Json>,
      },
    )

  if (error) throw new Error(error.message || 'Не удалось сохранить ссылку')
}

export async function removeLessonTemplateLinkMarker(path: string) {
  const { error } = await supabase.storage.from('lesson-library').remove([path])
  if (error) throw new Error(error.message || 'Не удалось удалить ссылку')
}

export async function loadLessonTemplateLinkMetadata(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)))
  if (!uniquePaths.length) return new Map<string, LessonTemplateLinkView>()

  const settled = await Promise.all(uniquePaths.map(async path => {
    const { data, error } = await supabase.storage.from('lesson-library').info(path)
    if (error || !isLinkMetadata(data?.metadata)) return null
    return [path, { path, title: data.metadata.title, url: data.metadata.url }] as const
  }))

  return new Map<string, LessonTemplateLinkView>(settled.filter(Boolean) as Array<readonly [string, LessonTemplateLinkView]>)
}
