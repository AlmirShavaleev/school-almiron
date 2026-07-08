import { getAssetUrl, safeDecodeStoragePath } from '@/hooks/useCatalog'
import { sanitizeHtml } from '@/utils/sanitizeHtml'
import type { CatalogTaskAsset } from '@/hooks/useCatalog'

/**
 * Resolves relative image src values in task HTML to Supabase Storage URLs,
 * injects CSS class names for correct sizing, wraps tables for horizontal scroll,
 * then sanitizes the result.
 *
 * This is the single source of truth — used by catalog pages, collection pages,
 * and cart previews. Do NOT copy this logic elsewhere.
 */
export function resolveTaskHtml(
  html: string | null | undefined,
  assets: CatalogTaskAsset[] | undefined,
): string {
  if (!html) return ''

  let resolved = html.replace(
    /<img\b([^>]*)\bsrc="([^"]*)"([^>]*)>/gi,
    (wholeTag, before, src, after) => {
      // Leave absolute URLs untouched (already resolved or external)
      if (/^https?:\/\/|^\/\//.test(src)) return wholeTag

      // Decode HTML entities in src (e.g. &#39; → ' for apostrophe filenames)
      const decodedSrc = src
        .replace(/&#(\d+);/g, (_: string, n: string) => String.fromCharCode(+n))
        .replace(/&#x([0-9a-fA-F]+);/gi, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

      const asset = assets?.find(a => {
        const decoded = safeDecodeStoragePath(a.storage_path)
        // alt === decodedSrc handles Cyrillic filenames stored as x-encoded ASCII
        return decoded.endsWith(`/${decodedSrc}`)
            || a.storage_path.endsWith(`/${decodedSrc}`)
            || a.alt === decodedSrc
            || a.alt === src
      })
      if (!asset) return wholeTag

      const url = getAssetUrl(asset.storage_path)
      const hasMathClass = /\bclass="[^"]*\bmath\b[^"]*"/i.test(before + after)

      const altMatch = /\balt="([^"]*)"/i.exec(before + after)
      const rawAlt = altMatch?.[1] ?? ''
      const isAnswerTemplate = hasMathClass && /^\s*\|[-|]/.test(rawAlt)

      const kindClass =
        isAnswerTemplate
          ? 'catalog-answer-template'
        : (asset.kind === 'solution' || asset.kind === 'solution_plan') && !hasMathClass
          ? 'catalog-solution-image'
        : asset.kind === 'condition' && !hasMathClass
          ? 'catalog-condition-figure'
        : ''

      const base = `<img${before} src="${url}"${after}>`
      if (!kindClass) return base
      if (/\bclass="/i.test(before + after)) {
        return base.replace(/\bclass="([^"]*)"/, `class="$1 ${kindClass}"`)
      }
      return `<img${before} src="${url}" class="${kindClass}"${after}>`
    }
  )

  // Wrap tables for horizontal scroll on narrow viewports
  resolved = resolved
    .replace(/<table/gi, '<div class="tbl-wrap"><table')
    .replace(/<\/table>/gi, '</table></div>')

  return sanitizeHtml(resolved)
}
