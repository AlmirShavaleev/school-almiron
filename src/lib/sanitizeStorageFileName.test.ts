
import { describe, it, expect } from 'vitest'
import { sanitizeStorageFileName, buildMaterialStoragePath } from './topicMaterialItems'

describe('sanitizeStorageFileName', () => {
  it('транслитерирует кириллицу', () => {
    expect(sanitizeStorageFileName('физмат школе.pdf')).toBe('fizmat_shkole.pdf')
  })
  it('чистит спецсимволы и пробелы', () => {
    expect(sanitizeStorageFileName('отчёт (финал)!.PDF')).toBe('otchet_final.pdf')
  })
  it('пустое/только символы -> file', () => {
    expect(sanitizeStorageFileName('###.png')).toBe('file.png')
    expect(sanitizeStorageFileName('')).toBe('file')
  })
  it('латиница сохраняется', () => {
    expect(sanitizeStorageFileName('Notes_v2-final.jpeg')).toBe('notes_v2-final.jpeg')
  })
})

describe('buildMaterialStoragePath c кириллицей', () => {
  it('путь без кириллицы', () => {
    const p = buildMaterialStoragePath('topic-1', 'физика.pdf', 123)
    expect(p).toBe('topic-1/123_fizika.pdf')
  })
})
