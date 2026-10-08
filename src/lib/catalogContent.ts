import { isCatalogMarkdown, renderCatalogMarkdown } from './catalogMarkdown'
import { getLoadedKatex } from './katexLoader'

/**
 * §269. Рисунки переписанного каталога — в Supabase Storage (публичный бакет
 * `catalog-figures`), а не в R2 (assets.alminion.ru за Cloudflare в России
 * тормозит). Адрес можно переопределить `VITE_CATALOG_FIGURES_BASE_URL`.
 */
export const CATALOG_FIGURES_BUCKET = 'catalog-figures'

export function catalogFiguresBaseUrl(): string {
  const override = (import.meta.env.VITE_CATALOG_FIGURES_BASE_URL ?? '').trim()
  if (override) return override.replace(/\/+$/, '')
  const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${supabaseUrl}/storage/v1/object/public/${CATALOG_FIGURES_BUCKET}`
}

/** Markdown-текст задачи → безопасный HTML (формулы — KaTeX, если уже загружен). */
export function renderCatalogContent(source: string): string {
  return renderCatalogMarkdown(source, { katex: getLoadedKatex(), figureBaseUrl: catalogFiguresBaseUrl() })
}

export { isCatalogMarkdown }
