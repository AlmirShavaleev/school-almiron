import { isCatalogMarkdown, renderCatalogMarkdown } from './catalogMarkdown'
import { getLoadedKatex } from './katexLoader'
import { CLOUD_SUPABASE_URL } from './cloudProject'

/**
 * §269. Рисунки переписанного каталога — в Supabase Storage (публичный бакет
 * `catalog-figures`), а не в R2 (assets.alminion.ru за Cloudflare в России
 * тормозит). Адрес можно переопределить `VITE_CATALOG_FIGURES_BASE_URL`.
 */
export const CATALOG_FIGURES_BUCKET = 'catalog-figures'

export function catalogFiguresBaseUrl(): string {
  // ВРЕМЕННО (авария self-hosted, ноябрь 2026): рисунки берём из того же проекта,
  // куда смотрит клиент Supabase (облачный School, см. src/lib/supabase.ts), а не из
  // переменных Vercel — те ведут на свой сервер, который сейчас недоступен, и рисунки
  // в условиях задач не грузились. При возврате на свой сервер — вернуть чтение
  // VITE_CATALOG_FIGURES_BASE_URL / VITE_SUPABASE_URL вместе с supabase.ts.
  const supabaseUrl = CLOUD_SUPABASE_URL.replace(/\/+$/, '')
  return `${supabaseUrl}/storage/v1/object/public/${CATALOG_FIGURES_BUCKET}`
}

/** Markdown-текст задачи → безопасный HTML (формулы — KaTeX, если уже загружен). */
export function renderCatalogContent(source: string): string {
  return renderCatalogMarkdown(source, { katex: getLoadedKatex(), figureBaseUrl: catalogFiguresBaseUrl() })
}

export { isCatalogMarkdown }
