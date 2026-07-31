/**
 * ВАЖНО про хост картинок. Раньше эти проверки ждали ссылок вида
 * `/storage/v1/...` — это Supabase Storage. Каталог давно переехал на R2
 * (`VITE_ASSETS_BASE_URL`), и в Supabase бакет `catalog-assets` пуст.
 * Проверки зелёнели только потому, что в локальном `.env` переменной не было
 * и код молча откатывался на мёртвый путь. Теперь смотрим не на домен, а на
 * то, что относительный `src` превратился в абсолютную ссылку и указывает на
 * нужный объект: домен — вопрос окружения, а не поведения.
 */
/**
 * Regression tests for resolveTaskHtml / image asset matching
 *
 * Covers the bugs found in the Math EGE audit:
 *  1. HTML entity &#39; in src → apostrophe filename matching
 *  2. Multiple assets for one task
 *  3. Same basename in different tex_session
 *  4. Missing asset → original tag returned unchanged
 *  5. Task with multiple img tags
 *  6. Geometry figure NOT mis-classified as answer template
 *  7. SVG with alt="PIC" matched correctly
 *  8. URL with space (%20) in storage_path
 *  9. Already-encoded storage_path (safeDecodeStoragePath)
 * 10. Absolute src left untouched
 */

import { describe, it, expect } from 'vitest'
import { resolveTaskHtml } from '../CatalogTaskContent'

// ── Minimal asset factory ──────────────────────────────────────────────────────

function asset(overrides: {
  id?: string
  tex_session_id?: number
  kind?: string
  storage_path: string
  alt?: string | null
  position?: number
}) {
  return {
    id:              overrides.id ?? 'asset-1',
    tex_session_id:  overrides.tex_session_id ?? 1,
    kind:            overrides.kind ?? 'condition',
    storage_path:    overrides.storage_path,
    alt:             overrides.alt ?? null,
    position:        overrides.position ?? 1,
  }
}

// ── 1. HTML entity &#39; → apostrophe match ────────────────────────────────────

describe('HTML entity decoding in src', () => {
  it('&#39; (apostrophe) src matches storage_path with actual apostrophe', () => {
    const assets = [asset({ storage_path: "math-ege/4794/AV_22_shk_1'.png", alt: 'PIC' })]
    const html = `<img alt="PIC" src="AV_22_shk_1&#39;.png"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain("AV_22_shk_1'.png")
    expect(result).toContain('src="https://')
    expect(result).not.toContain('src="AV_22_shk_1&#39;.png"')
  })

  it('double apostrophe &#39;&#39; src matches filename with two apostrophes', () => {
    const assets = [asset({ storage_path: "math-ege/86324/AV_22_st_167''.png", alt: 'PIC' })]
    const html = `<img src="AV_22_st_167&#39;&#39;.png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain("AV_22_st_167''.png")
    expect(result).toContain('src="https://')
  })

  it('no entity: plain src still matches normally', () => {
    const assets = [asset({ storage_path: 'math-ege/1861/DI_703.png', alt: 'PIC' })]
    const html = `<img alt="PIC" src="DI_703.png"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain('DI_703.png')
    expect(result).toContain('src="https://')
  })
})

// ── 2. Multiple assets for one task ───────────────────────────────────────────

describe('Multiple assets per task', () => {
  it('resolves each img to its correct asset', () => {
    const assets = [
      asset({ storage_path: 'math-ege/1000/figure.png',       kind: 'condition', alt: 'PIC' }),
      asset({ storage_path: 'math-ege/1000/formula.svg',      kind: 'condition', alt: 'x+y' }),
      asset({ storage_path: 'math-ege/1001/solution.png',     kind: 'solution',  alt: 'PIC' }),
    ]
    const html = `<p><img src="figure.png" alt="PIC"/><img src="formula.svg" alt="x+y"/></p>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain('math-ege/1000/figure.png')
    expect(result).toContain('math-ege/1000/formula.svg')
    expect(result).not.toContain('src="figure.png"')
    expect(result).not.toContain('src="formula.svg"')
  })
})

// ── 3. Same basename in different tex_session ─────────────────────────────────

describe('Same basename in different tex_session', () => {
  it('returns the first match (find()) without error', () => {
    const assets = [
      asset({ storage_path: 'math-ege/3380/DI_2532.png', kind: 'solution',  alt: 'PIC', position: 1 }),
      asset({ storage_path: 'math-ege/3381/DI_2532.png', kind: 'condition', alt: 'PIC', position: 2 }),
    ]
    const html = `<img src="DI_2532.png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    // Should resolve (pick the first match), not break
    expect(result).toContain('src="https://')
    expect(result).not.toContain('src="DI_2532.png"')
  })
})

// ── 4. Missing asset → original tag returned ──────────────────────────────────

describe('Missing asset', () => {
  it('returns original img tag when no asset matches', () => {
    const assets = [
      asset({ storage_path: 'math-ege/9999/other.png' }),
    ]
    const html = `<img src="missing.png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    // Original tag preserved — browser will show alt text
    expect(result).toContain('src="missing.png"')
    expect(result).not.toContain('src="https://')
  })

  it('empty assets array → all img tags returned unchanged', () => {
    const html = `<img src="figure.png" alt="PIC"><img src="formula.svg" alt="x">`
    const result = resolveTaskHtml(html, [])
    expect(result).toContain('src="figure.png"')
    expect(result).toContain('src="formula.svg"')
  })
})

// ── 5. Task with multiple img tags in one HTML ────────────────────────────────

describe('Task with multiple img tags', () => {
  it('resolves all 9 img tags in a complex statement', () => {
    const makeAsset = (name: string, session: number) =>
      asset({ storage_path: `math-ege/${session}/${name}`, kind: 'condition', alt: name.endsWith('.png') ? 'PIC' : name })
    const names = ['a.svg','b.svg','c.svg','d.svg','e.svg','f.svg','g.svg','h.svg','fig.png']
    const assets = names.map((n, i) => makeAsset(n, 1000 + i))
    const html = names.map(n => `<img src="${n}" alt="${n.endsWith('.png') ? 'PIC' : n}"/>`).join(' ')
    const result = resolveTaskHtml(html, assets)
    for (const n of names) {
      expect(result, `${n} should be resolved`).not.toContain(`src="${n}"`)
      expect(result).toContain(n)
    }
  })
})

// ── 6. Geometry figure NOT classified as answer template ──────────────────────

describe('Answer template classification', () => {
  it('condition figure (no math class, alt=PIC) gets catalog-condition-figure class', () => {
    const assets = [asset({ storage_path: 'math-ege/1861/DI_703.png', kind: 'condition', alt: 'PIC' })]
    const html = `<img alt="PIC" src="DI_703.png"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain('catalog-condition-figure')
    expect(result).not.toContain('catalog-answer-template')
  })

  it('SVG formula with math class and pipe-table alt gets catalog-answer-template class', () => {
    const assets = [asset({ storage_path: 'math-ege/99/tmpl.svg', kind: 'condition', alt: '|--|--|' })]
    const html = `<img class="math" src="tmpl.svg" alt="|--|--|"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain('catalog-answer-template')
  })

  it('geometry PIC with math class does NOT get answer-template (alt not pipe-table)', () => {
    const assets = [asset({ storage_path: 'math-ege/2/geo.png', kind: 'condition', alt: 'PIC' })]
    const html = `<img class="math" src="geo.png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).not.toContain('catalog-answer-template')
  })
})

// ── 7. SVG with alt="PIC" ─────────────────────────────────────────────────────

describe('SVG with alt=PIC', () => {
  it('condition SVG with alt=PIC is resolved and classified as condition-figure', () => {
    const assets = [asset({ storage_path: 'math-ege/500/geo.svg', kind: 'condition', alt: 'PIC' })]
    const html = `<img src="geo.svg" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain('geo.svg')
    expect(result).toContain('src="https://')
    expect(result).toContain('catalog-condition-figure')
  })
})

// ── 8. URL with %20 (space) in storage_path ───────────────────────────────────

describe('Space / %20 in storage path', () => {
  it('storage_path with space matches src with space', () => {
    const assets = [asset({ storage_path: 'math-ege/100/NT_8_25 (1).png', alt: 'PIC' })]
    const html = `<img src="NT_8_25 (1).png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain('src="https://')
  })

  it('already-encoded %20 path decodes to space and still resolves', () => {
    // Storage path pre-encoded — safeDecodeStoragePath decodes it
    const assets = [asset({ storage_path: 'math-ege/100/NT_8_25%20(1).png', alt: 'PIC' })]
    // src in HTML uses space, not %20
    const html = `<img src="NT_8_25 (1).png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    // safeDecodeStoragePath("math-ege/100/NT_8_25%20(1).png") = "math-ege/100/NT_8_25 (1).png"
    // decoded.endsWith("/NT_8_25 (1).png") → TRUE
    expect(result).toContain('src="https://')
  })
})

// ── 9. Already-encoded storage_path (double-encode guard) ─────────────────────

describe('safeDecodeStoragePath guards', () => {
  it('double-encoded path: safeDecodeStoragePath prevents double-decode by catching error', () => {
    // A lone % that would fail decodeURIComponent — should fall back to original
    const assets = [asset({ storage_path: 'math-ege/1/file%2Bname.png', alt: 'PIC' })]
    const html = `<img src="file+name.png" alt="PIC"/>`
    // + is not %2B after decode, so the match may fail — but we should NOT throw
    expect(() => resolveTaskHtml(html, assets)).not.toThrow()
  })
})

// ── 10. Absolute src left untouched ───────────────────────────────────────────

describe('Absolute src', () => {
  it('https:// src is returned unchanged', () => {
    const assets = [asset({ storage_path: 'math-ege/1/img.png', alt: 'PIC' })]
    const url = 'https://example.com/img.png'
    const html = `<img src="${url}" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    expect(result).toContain(`src="${url}"`)
  })
})

// ── 11. Duplicate basename: select last (newest) asset ─────────────────────────

describe('Duplicate basename selection', () => {
  it('when two assets share the same basename, selects the LAST one (by position)', () => {
    // Simulate two tex_sessions with the same filename
    const assets = [
      asset({ storage_path: 'physics-ege/36250/18438.png', alt: 'PIC', position: 4 }),
      asset({ storage_path: 'physics-oge/87940/46353.png', alt: 'PIC', position: 5 }),
      asset({ storage_path: 'physics-ege/364323/18438.png', alt: 'PIC', position: 35 }), // newer session
    ]
    const html = `<img src="18438.png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    // Should resolve to the LAST matching asset (position=35)
    expect(result).toContain('physics-ege/364323/18438.png')
    expect(result).not.toContain('physics-ege/36250/18438.png')
    expect(result).toContain('src="https://')
  })

  it('handles multiple duplicate basenames in same HTML', () => {
    const assets = [
      asset({ storage_path: 'physics-ege/36250/18438.png', alt: 'PIC', position: 4 }),
      asset({ storage_path: 'physics-ege/364323/18438.png', alt: 'PIC', position: 35 }),
      asset({ storage_path: 'physics-ege/36250/46353.png', alt: 'PIC', position: 10 }),
      asset({ storage_path: 'physics-oge/87941/46353.png', alt: 'PIC', position: 40 }),
    ]
    const html = `<img src="18438.png" alt="PIC"/> <img src="46353.png" alt="PIC"/>`
    const result = resolveTaskHtml(html, assets)
    // Both should resolve to the LAST matching asset
    expect(result).toContain('physics-ege/364323/18438.png')
    expect(result).not.toContain('physics-ege/36250/18438.png')
    expect(result).toContain('physics-oge/87941/46353.png')
    expect(result).not.toContain('physics-ege/36250/46353.png')
  })
})
