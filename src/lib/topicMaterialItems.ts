/**
 * Чистые помощники для материалов темы курса.
 *
 * Здесь нет обращений к сети — только нормализация и валидация, зеркалящие
 * констрейнты БД из миграции topic_material_items_repoint_to_topics.sql:
 *   - topic_material_items_payload_chk — ровно одно поле под тип;
 *   - topic_material_items_url_chk     — url только http(s).
 *
 * Смысл дублирования: поймать ошибку в форме до похода в базу и дать
 * человеку понятное сообщение вместо 23514 check_violation.
 */

export const TOPIC_MATERIALS_BUCKET = 'topic-materials'

/**
 * Бакет, из которого жили материалы, пока они висели на уроке.
 * Один файл, загруженный до переезда модели, лежит там по пути с lesson_id.
 */
export const LEGACY_LESSON_MATERIALS_BUCKET = 'course-lesson-materials'

/**
 * Бакет старой модели topic_materials. Записи, перенесённые оттуда, хранят
 * путь вида `topics/{topic_id}/{type}/…` и физически остаются здесь.
 */
export const LEGACY_TOPIC_MATERIALS_BUCKET = 'course-materials'

export type TopicMaterialKind = 'text' | 'video' | 'link' | 'file'

export const TOPIC_MATERIAL_KINDS: readonly TopicMaterialKind[] = ['text', 'video', 'link', 'file'] as const

export const TOPIC_MATERIAL_LABELS: Record<TopicMaterialKind, string> = {
  text: 'Текст',
  video: 'Видео',
  link: 'Ссылка',
  file: 'Файл',
}

/** Строка topic_material_items как её отдаёт PostgREST. */
export interface TopicMaterialItemRow {
  id: string
  topic_id: string
  kind: TopicMaterialKind
  title: string | null
  content: string | null
  url: string | null
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  position: number
  is_visible: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/**
 * Материал в форме, удобной для UI: тип-дискриминант гарантирует, что нужное
 * поле есть, и компонентам не нужно проверять null у полей чужих типов.
 */
export type TopicMaterial =
  | { kind: 'text'; id: string; title: string | null; position: number; isVisible: boolean; content: string }
  | { kind: 'video'; id: string; title: string | null; position: number; isVisible: boolean; url: string }
  | { kind: 'link'; id: string; title: string | null; position: number; isVisible: boolean; url: string }
  | {
      kind: 'file'
      id: string
      title: string | null
      position: number
      isVisible: boolean
      storagePath: string
      fileName: string | null
      sizeBytes: number | null
    }

/** Приводит строку БД к дискриминированному виду. Возвращает null, если строка битая. */
export function toTopicMaterial(row: TopicMaterialItemRow): TopicMaterial | null {
  const base = { id: row.id, title: row.title, position: row.position, isVisible: row.is_visible }
  switch (row.kind) {
    case 'text':
      return row.content ? { ...base, kind: 'text', content: row.content } : null
    case 'video':
      return row.url ? { ...base, kind: 'video', url: row.url } : null
    case 'link':
      return row.url ? { ...base, kind: 'link', url: row.url } : null
    case 'file':
      return row.storage_path
        ? {
            ...base,
            kind: 'file',
            storagePath: row.storage_path,
            fileName: row.file_name,
            sizeBytes: row.size_bytes,
          }
        : null
    default:
      return null
  }
}

/**
 * Нормализует ссылку: добавляет https:// голому домену и режет пробелы.
 * Возвращает null, если ссылку принять нельзя.
 *
 * Отдельно и намеренно отсекаются javascript:, data:, vbscript: и file: —
 * без этого такая строка доехала бы до href в интерфейсе ученика.
 */
export function normalizeMaterialUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null

  return parsed.toString()
}

/**
 * Из какого бакета читать файл.
 *
 * Storage-политики нового бакета требуют, чтобы первым сегментом пути был
 * topic_id. Но в таблице лежат материалы трёх поколений, и путь — единственный
 * способ отличить их:
 *   `{topic_id}/…` — новый бакет;
 *   `topics/{topic_id}/{type}/…` — записи, перенесённые из старой модели
 *      topic_materials, файлы остались в бакете course-materials;
 *   всё остальное (`{lesson_id}/…`) — короткий период, когда материалы висели
 *      на уроке.
 * Так ни один уже загруженный файл не теряется.
 */
export function bucketForMaterialPath(storagePath: string, topicId: string) {
  if (storagePath.startsWith(`${topicId}/`)) return TOPIC_MATERIALS_BUCKET
  if (storagePath.startsWith('topics/')) return LEGACY_TOPIC_MATERIALS_BUCKET
  return LEGACY_LESSON_MATERIALS_BUCKET
}

/** Путь в бакете. Конвенция завязана на storage-политики: первый сегмент — topic_id. */
export function buildMaterialStoragePath(topicId: string, fileName: string, now: number = Date.now()): string {
  const safeName = (fileName || 'file')
    .replace(/[/\\]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(-120)
  return `${topicId}/${now}_${safeName}`
}

export interface MaterialDraft {
  kind: TopicMaterialKind
  title?: string | null
  content?: string | null
  url?: string | null
  storagePath?: string | null
  fileName?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
}

export interface MaterialInsertPayload {
  topic_id: string
  kind: TopicMaterialKind
  title: string | null
  content: string | null
  url: string | null
  storage_path: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  position: number
  created_by: string
}

/**
 * Собирает payload для вставки, обнуляя поля чужих типов.
 * Бросает Error с человеческим текстом, если данных не хватает.
 */
export function buildMaterialInsert(
  topicId: string,
  createdBy: string,
  position: number,
  draft: MaterialDraft,
): MaterialInsertPayload {
  const title = draft.title?.trim() ? draft.title.trim() : null
  const base = {
    topic_id: topicId,
    kind: draft.kind,
    title,
    content: null as string | null,
    url: null as string | null,
    storage_path: null as string | null,
    file_name: null as string | null,
    mime_type: null as string | null,
    size_bytes: null as number | null,
    position,
    created_by: createdBy,
  }

  switch (draft.kind) {
    case 'text': {
      const content = draft.content?.trim()
      if (!content) throw new Error('Текст материала не может быть пустым')
      return { ...base, content }
    }
    case 'video':
    case 'link': {
      const url = normalizeMaterialUrl(draft.url ?? '')
      if (!url) throw new Error('Укажите корректную ссылку (http или https)')
      return { ...base, url }
    }
    case 'file': {
      const storagePath = draft.storagePath?.trim()
      if (!storagePath) throw new Error('Файл не загружен')
      return {
        ...base,
        storage_path: storagePath,
        file_name: draft.fileName ?? null,
        mime_type: draft.mimeType ?? null,
        size_bytes: draft.sizeBytes ?? null,
      }
    }
  }
}

/** Встраиваемая ссылка для YouTube/Vimeo, иначе null — покажем обычной ссылкой. */
export function getVideoEmbedUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed${u.pathname}`
  if (u.hostname.includes('youtube.com')) {
    if (u.pathname.startsWith('/embed/')) return url
    const v = u.searchParams.get('v')
    if (v) return `https://www.youtube.com/embed/${v}`
  }
  if (u.hostname.includes('vimeo.com')) {
    const id = u.pathname.match(/(\d+)/)?.[1]
    if (id) return `https://player.vimeo.com/video/${id}`
  }
  return null
}

/** Материалы, видимые ученику: только is_visible. */
export function visibleMaterialsForStudent<T extends { isVisible: boolean }>(materials: T[]): T[] {
  return materials.filter(m => m.isVisible)
}
