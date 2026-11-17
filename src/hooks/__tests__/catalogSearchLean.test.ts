import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Проверяем сетевой контракт именно поиска: он не должен случайно
 * вернуть загрузку полных карточек, решений и десятков изображений.
 */
describe('catalog search light requests', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/hooks/useCatalog.ts'), 'utf8')
  const start = source.indexOf('export function useCatalogSearchPreview(')
  const end = source.indexOf('export function useCatalogSearch(', start)
  const search = source.slice(start, end)

  it('получает только поля, которые показывает результат поиска', () => {
    expect(source).toContain('export function useCatalogSearch(')
    expect(readFileSync(resolve(process.cwd(), 'src/pages/catalog/CatalogSectionPage.tsx'), 'utf8')).toContain('useCatalogSearchPreview(query, sectionId, searchEnabled)')
    expect(source).toContain("const CATALOG_SEARCH_COLUMNS = 'id, external_id, section_id, statement_html'")
    expect(search).toContain('.select(CATALOG_SEARCH_COLUMNS)')
    expect(search).not.toContain('fetchTasksByIds(')
    expect(search).not.toContain('fetchCatalogTaskTexts(')
    expect(search).not.toContain('catalog_task_assets')
    expect(search).not.toContain('answer_html')
    expect(search).not.toContain('solution_html')
  })

  it('загружает тему только для персонала и только когда есть результаты', () => {
    expect(search).toContain("if (rows.length && CATALOG_SEARCH_STAFF_ROLES.has(profile?.role ?? ''))")
    expect(search).toContain(".from('catalog_task_topics')")
    expect(search).toContain("hasTopicAssigned: CATALOG_SEARCH_STAFF_ROLES.has(profile?.role ?? '')")
  })

  it('сохраняет поиск по номеру, поиск по тексту, debounce и защиту от старых ответов', () => {
    expect(search).toContain(".eq('external_id', parseInt(q, 10))")
    expect(search).toContain(".ilike('statement_html', `%${q}%`)")
    expect(search).toContain('setTimeout(search, 300)')
    expect(search).toContain('if (cancelled) return')
    expect(search).toContain("return () => { cancelled = true; clearTimeout(timer) }")
  })
})
