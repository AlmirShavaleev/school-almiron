import { describe, expect, it } from 'vitest'
import katex from 'katex'
import {
  CATALOG_MD_MARKER, escapeHtml, extractMath, figureUrl, hasPendingMath, isCatalogMarkdown, renderCatalogMarkdown,
  upgradeCatalogMath, withCatalogMarkdownMarker,
} from '@/lib/catalogMarkdown'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'
import { resolveTaskHtml as resolveCatalogContentHtml } from '@/components/catalog/CatalogTaskContent'

/** §269. Markdown + LaTeX задач переписанного каталога: подмножество разметки, KaTeX, экранирование. */
const BASE = 'https://proj.supabase.co/storage/v1/object/public/catalog-figures'
const render = (md: string, withKatex = true) => renderCatalogMarkdown(md, { katex: withKatex ? katex : null, figureBaseUrl: BASE })

describe('метка формата', () => {
  it('распознаётся в начале текста, в том числе после пробелов', () => {
    expect(isCatalogMarkdown(`${CATALOG_MD_MARKER}\nтекст`)).toBe(true)
    expect(isCatalogMarkdown(`  ${CATALOG_MD_MARKER}текст`)).toBe(true)
    expect(isCatalogMarkdown('<p>старая задача</p>')).toBe(false)
    expect(isCatalogMarkdown(null)).toBe(false)
    expect(withCatalogMarkdownMarker('a')).toBe(`${CATALOG_MD_MARKER}\na`)
  })
})

describe('формулы', () => {
  it('extractMath: $…$, $$…$$, \\$ и незакрытый доллар', () => {
    const r = extractMath('Цена \\$5, $a_x = -8$ и $$v^2$$, а $ просто так')
    expect(r.math).toEqual([{ tex: 'a_x = -8', display: false }, { tex: 'v^2', display: true }])
    expect(r.text).toContain('Цена $5')
    expect(r.text).toContain('а $ просто так')
  })
  it('KaTeX: строчная формула, выносная — блоком; * и _ внутри TeX — не разметка', () => {
    const html = render('Скорость $V^* = v_0 t$ и **жирно**.\n\n$$\\dfrac{a}{2b}$$')
    expect(html).toContain('class="katex"')
    expect(html).toContain('<div class="catalog-math-block"><span class="katex-display">')
    expect(html).toContain('<strong>жирно</strong>')
    expect(html).not.toContain('<em>')
    expect(html).not.toContain('katex-error')
  })
  it('без KaTeX — исходник в «ждущем» узле, экранированный; upgradeCatalogMath дорисовывает', () => {
    const html = render('Пусть $a<b$ и $$x$$', false)
    expect(hasPendingMath(html)).toBe(true)
    expect(html).toContain('<span class="catalog-math catalog-math-pending">a&lt;b</span>')
    const root = document.createElement('div')
    root.innerHTML = html
    expect(upgradeCatalogMath(root, katex)).toBe(2)
    expect(root.querySelector('.catalog-math-pending')).toBeNull()
    expect(root.querySelectorAll('.katex').length).toBe(2)
    expect(root.querySelector('.catalog-math-display .katex-display')).not.toBeNull()
  })
  it('KaTeX без trust: \\href не превращается в ссылку', () => {
    const html = render('$\\href{javascript:alert(1)}{x}$')
    expect(html).not.toMatch(/<a\b/)
  })
})

describe('разметка', () => {
  it('абзацы — по пустой строке, строки «А) …» внутри абзаца — через <br>', () => {
    const html = render('Первый абзац.\n\nА) радиус\nБ) скорость')
    expect(html).toBe('<div class="catalog-md"><p>Первый абзац.</p><p>А) радиус<br>Б) скорость</p></div>')
  })
  it('списки «- …» и «1. …»', () => {
    const html = render('Путь:\n- первый;\n- второй.\n\n3. третий\n4. четвёртый')
    expect(html).toContain('<p>Путь:</p><ul><li>первый;</li><li>второй.</li></ul>')
    expect(html).toContain('<ol start="3"><li>третий</li><li>четвёртый</li></ol>')
  })
  it('таблица GFM (формулы в ячейках, \\| внутри ячейки)', () => {
    const html = render('Данные:\n\n| $F,\\ \\text{Н}$ | 1,5 | 2 |\n| --- | --- | --- |\n| $x$ | 0,02 | a\\|b |')
    expect(html).toContain('<div class="tbl-wrap"><table><thead><tr><th><span class="katex">')
    expect(html).toContain('<td>0,02</td><td>a|b</td>')
    expect(html).not.toContain('---')
  })
  it('сырой HTML в источнике экранируется', () => {
    const html = render('<img src=x onerror=alert(1)> <script>alert(1)</script> **<b>жирно</b>**')
    expect(html).not.toMatch(/<img|<script|<b>/)
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('<strong>&lt;b&gt;жирно&lt;/b&gt;</strong>')
  })
  it('рисунок — только путь бакета, через <img>; чужой адрес — текстом', () => {
    const html = render('Текст.\n\n![Рисунок](fig:fizika-ege/abc123.svg)\n\n![x](https://evil.example/a.svg)\n\n![y](fig:../secret.svg)')
    expect(html).toContain(`<img src="${BASE}/fizika-ege/abc123.svg" alt="Рисунок" class="catalog-condition-figure" loading="lazy" decoding="async">`)
    expect(html).not.toContain('evil.example/a.svg"')
    expect(html.match(/<img/g)?.length).toBe(1)
    expect(figureUrl(BASE, 'a/../b.svg')).toBeNull()
    expect(figureUrl(BASE, 'javascript:alert(1)')).toBeNull()
    expect(figureUrl(`${BASE}/`, 'a.svg')).toBe(`${BASE}/a.svg`)
  })
  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
  })
})

describe('resolveTaskHtml', () => {
  it('Markdown-задача — свой рендер в обоих resolveTaskHtml; метка не выводится', () => {
    for (const fn of [resolveTaskHtml, resolveCatalogContentHtml]) {
      const html = fn(`${CATALOG_MD_MARKER}\nНайдите $a_x$.\n\n<b>x</b>`, [])
      expect(html.startsWith('<div class="catalog-md">')).toBe(true)
      expect(html).not.toContain(CATALOG_MD_MARKER)
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    }
  })
  it('старая HTML-задача — как раньше (санитайзер, таблица в обёртке)', () => {
    const legacy = '<p>Условие <b>x</b></p><table><tr><td>1</td></tr></table><script>alert(1)</script>'
    const html = resolveTaskHtml(legacy, [])
    expect(html).toContain('<p>Условие <b>x</b></p>')
    expect(html).toContain('<div class="tbl-wrap"><table>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('catalog-md')
  })
})
