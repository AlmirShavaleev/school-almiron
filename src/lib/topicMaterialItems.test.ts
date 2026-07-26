import { describe, it, expect } from 'vitest'
import {
  bucketForMaterialPath,
  buildMaterialInsert,
  buildMaterialStoragePath,
  getVideoEmbedUrl,
  normalizeMaterialUrl,
  toTopicMaterial,
  visibleMaterialsForStudent,
  type TopicMaterialItemRow,
} from './topicMaterialItems'

const TOPIC = 'f0000000-0000-0000-0000-000000000001'
const AUTHOR = 'a0000000-0000-0000-0000-000000000001'

function row(patch: Partial<TopicMaterialItemRow>): TopicMaterialItemRow {
  return {
    id: 'm1', topic_id: TOPIC, kind: 'text', title: null, content: null, url: null,
    storage_path: null, file_name: null, mime_type: null, size_bytes: null,
    position: 0, is_visible: true, created_by: AUTHOR,
    created_at: '2026-07-25T00:00:00Z', updated_at: '2026-07-25T00:00:00Z',
    ...patch,
  }
}

// ── Ссылки ────────────────────────────────────────────────────────────────────

describe('normalizeMaterialUrl', () => {
  it('пропускает http и https', () => {
    expect(normalizeMaterialUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeMaterialUrl('http://example.com/')).toBe('http://example.com/')
  })

  it('достраивает https:// голому домену', () => {
    expect(normalizeMaterialUrl('example.com/page')).toBe('https://example.com/page')
  })

  it('обрезает пробелы', () => {
    expect(normalizeMaterialUrl('  https://example.com/  ')).toBe('https://example.com/')
  })

  it('отвергает javascript:, data:, vbscript: и file:', () => {
    expect(normalizeMaterialUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeMaterialUrl('JavaScript:alert(1)')).toBeNull()
    expect(normalizeMaterialUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull()
    expect(normalizeMaterialUrl('vbscript:msgbox(1)')).toBeNull()
    expect(normalizeMaterialUrl('file:///etc/passwd')).toBeNull()
  })

  it('отвергает пустую строку', () => {
    expect(normalizeMaterialUrl('')).toBeNull()
    expect(normalizeMaterialUrl('   ')).toBeNull()
  })
})

// ── Сборка payload: зеркало CHECK-констрейнтов БД ────────────────────────────

describe('buildMaterialInsert', () => {
  it('text: кладёт content, обнуляет url и storage_path', () => {
    const p = buildMaterialInsert(TOPIC, AUTHOR, 0, { kind: 'text', content: ' Конспект ', title: ' Тема ' })
    expect(p).toMatchObject({ kind: 'text', content: 'Конспект', title: 'Тема', url: null, storage_path: null })
    expect(p.topic_id).toBe(TOPIC)
    expect(p.created_by).toBe(AUTHOR)
  })

  it('video и link: кладут нормализованный url, обнуляют content', () => {
    const v = buildMaterialInsert(TOPIC, AUTHOR, 1, { kind: 'video', url: 'youtu.be/xyz' })
    expect(v.url).toBe('https://youtu.be/xyz')
    expect(v.content).toBeNull()
    expect(v.storage_path).toBeNull()

    const l = buildMaterialInsert(TOPIC, AUTHOR, 2, { kind: 'link', url: 'https://ege.sdamgia.ru' })
    expect(l.url).toBe('https://ege.sdamgia.ru/')
    expect(l.content).toBeNull()
  })

  it('file: кладёт storage_path и метаданные, обнуляет url', () => {
    const f = buildMaterialInsert(TOPIC, AUTHOR, 3, {
      kind: 'file', storagePath: `${TOPIC}/1_a.pdf`, fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 100,
    })
    expect(f).toMatchObject({ kind: 'file', storage_path: `${TOPIC}/1_a.pdf`, file_name: 'a.pdf', size_bytes: 100, url: null, content: null })
  })

  it('пустой заголовок превращается в null, а не в пустую строку', () => {
    const p = buildMaterialInsert(TOPIC, AUTHOR, 0, { kind: 'text', content: 'x', title: '   ' })
    expect(p.title).toBeNull()
  })

  it('падает на пустом тексте', () => {
    expect(() => buildMaterialInsert(TOPIC, AUTHOR, 0, { kind: 'text', content: '   ' })).toThrow(/пуст/i)
  })

  it('падает на некорректной ссылке', () => {
    expect(() => buildMaterialInsert(TOPIC, AUTHOR, 0, { kind: 'link', url: 'javascript:alert(1)' })).toThrow(/ссылк/i)
  })

  it('падает, если файл не загружен', () => {
    expect(() => buildMaterialInsert(TOPIC, AUTHOR, 0, { kind: 'file' })).toThrow(/файл/i)
  })
})

// ── Путь в бакете: первый сегмент обязан быть topic_id ───────────────────────

describe('buildMaterialStoragePath', () => {
  it('первым сегментом ставит topic_id — на этом держатся storage-политики', () => {
    const path = buildMaterialStoragePath(TOPIC, 'конспект.pdf', 1700000000000)
    expect(path.split('/')[0]).toBe(TOPIC)
    expect(path).toBe(`${TOPIC}/1700000000000_конспект.pdf`)
  })

  it('вычищает слэши из имени файла, чтобы нельзя было уйти в чужую папку', () => {
    const path = buildMaterialStoragePath(TOPIC, '../../other/hack.pdf', 1)
    expect(path.split('/').length).toBe(2)
    expect(path.split('/')[0]).toBe(TOPIC)
  })

  it('заменяет пробелы', () => {
    expect(buildMaterialStoragePath(TOPIC, 'моя работа.pdf', 1)).toBe(`${TOPIC}/1_моя_работа.pdf`)
  })
})

// Материал, загруженный до переезда модели с урока на тему, лежит в старом
// бакете и начинается с lesson_id. Он должен продолжать открываться.
describe('bucketForMaterialPath', () => {
  it('новый путь с topic_id — новый бакет', () => {
    expect(bucketForMaterialPath(`${TOPIC}/1_a.pdf`, TOPIC)).toBe('topic-materials')
  })

  it('старый путь с lesson_id — бакет периода уроков, файл не теряется', () => {
    const legacy = '187d7d1c-ec07-4851-a840-71669aafef7e/1785033049328_a.pdf'
    expect(bucketForMaterialPath(legacy, TOPIC)).toBe('course-lesson-materials')
  })

  it('путь перенесённой записи topic_materials — бакет course-materials', () => {
    const migrated = `topics/${TOPIC}/notes/1784381700224.pdf`
    expect(bucketForMaterialPath(migrated, TOPIC)).toBe('course-materials')
  })

  it('перенесённый путь не путается с новым, даже если topic_id совпадает', () => {
    expect(bucketForMaterialPath(`topics/${TOPIC}/theory/1.pdf`, TOPIC)).toBe('course-materials')
    expect(bucketForMaterialPath(`${TOPIC}/1_new.pdf`, TOPIC)).toBe('topic-materials')
  })
})

// ── Маппинг строк БД ─────────────────────────────────────────────────────────

describe('toTopicMaterial', () => {
  it('раскладывает по типам', () => {
    expect(toTopicMaterial(row({ kind: 'text', content: 'abc' }))).toMatchObject({ kind: 'text', content: 'abc' })
    expect(toTopicMaterial(row({ kind: 'video', url: 'https://y.tv/1' }))).toMatchObject({ kind: 'video', url: 'https://y.tv/1' })
    expect(toTopicMaterial(row({ kind: 'link', url: 'https://a.ru' }))).toMatchObject({ kind: 'link', url: 'https://a.ru' })
    expect(toTopicMaterial(row({ kind: 'file', storage_path: 'p/a.pdf', file_name: 'a.pdf' })))
      .toMatchObject({ kind: 'file', storagePath: 'p/a.pdf', fileName: 'a.pdf' })
  })

  it('возвращает null на битой строке вместо падения рендера', () => {
    expect(toTopicMaterial(row({ kind: 'text', content: null }))).toBeNull()
    expect(toTopicMaterial(row({ kind: 'video', url: null }))).toBeNull()
    expect(toTopicMaterial(row({ kind: 'file', storage_path: null }))).toBeNull()
  })

  it('переносит is_visible в isVisible', () => {
    expect(toTopicMaterial(row({ kind: 'text', content: 'x', is_visible: false }))).toMatchObject({ isVisible: false })
  })
})

// ── Видимость для ученика ────────────────────────────────────────────────────

describe('видимость для ученика', () => {
  it('скрытые материалы отфильтровываются', () => {
    const mats = [
      { id: 'a', isVisible: true },
      { id: 'b', isVisible: false },
    ]
    expect(visibleMaterialsForStudent(mats).map(m => m.id)).toEqual(['a'])
  })
})

// ── Видео ────────────────────────────────────────────────────────────────────

describe('getVideoEmbedUrl', () => {
  it('youtu.be', () => {
    expect(getVideoEmbedUrl('https://youtu.be/abc123')).toBe('https://www.youtube.com/embed/abc123')
  })
  it('youtube.com/watch?v=', () => {
    expect(getVideoEmbedUrl('https://www.youtube.com/watch?v=abc123')).toBe('https://www.youtube.com/embed/abc123')
  })
  it('уже embed — оставляет как есть', () => {
    expect(getVideoEmbedUrl('https://www.youtube.com/embed/abc')).toBe('https://www.youtube.com/embed/abc')
  })
  it('vimeo', () => {
    expect(getVideoEmbedUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871')
  })
  it('произвольная ссылка — null, покажем обычной ссылкой', () => {
    expect(getVideoEmbedUrl('https://example.com/video.mp4')).toBeNull()
  })
  it('мусор не роняет', () => {
    expect(getVideoEmbedUrl('не ссылка')).toBeNull()
  })
})
