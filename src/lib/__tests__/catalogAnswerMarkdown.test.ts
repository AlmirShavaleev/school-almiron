import { describe, expect, it } from 'vitest'
import katex from 'katex'
import { catalogAnswerSource, isCatalogMarkdown, renderCatalogMarkdown, withCatalogMarkdownMarker } from '@/lib/catalogMarkdown'
import { buildKeyTable, buildAnswersList, type PrintableItem } from '@/utils/variantPrintUtils'
import { resolveTaskHtml } from '@/utils/resolveTaskHtml'

/**
 * Каталог математики ЕГЭ (загрузка 15.10): условие и решение — Markdown с
 * меткой, а `answer_html` — голый текст «а) $\pm\dfrac{\pi}{6}+2\pi k,\ k\in\mathbb{Z}$; б) …».
 * Ответ обязан рисоваться тем же Markdown+KaTeX, что условие.
 */
const ANSWER = String.raw`а) $\pm\dfrac{\pi}{6}+2\pi k,\ k\in\mathbb{Z}$; б) $\dfrac{11\pi}{6};\ \dfrac{13\pi}{6}$`
const MD_STATEMENT = withCatalogMarkdownMarker(String.raw`Решите уравнение $2\cos x = \sqrt3$.`)
const render = (s: string) => renderCatalogMarkdown(s, { katex, figureBaseUrl: 'https://x/catalog-figures' })

describe('ответ Markdown-задачи', () => {
  it('без метки у ответа — получает её от условия или content_format', () => {
    expect(isCatalogMarkdown(catalogAnswerSource(ANSWER, { statement_html: MD_STATEMENT }))).toBe(true)
    expect(isCatalogMarkdown(catalogAnswerSource(ANSWER, { statement_html: '<p>…</p>', content_format: 'md' }))).toBe(true)
  })

  it('HTML-задача и уже размеченный ответ — без изменений; пустой — как был', () => {
    expect(catalogAnswerSource('<p>-1,6</p>', { statement_html: '<p>старая</p>', content_format: 'html' })).toBe('<p>-1,6</p>')
    const marked = withCatalogMarkdownMarker('$x$')
    expect(catalogAnswerSource(marked, { statement_html: MD_STATEMENT })).toBe(marked)
    expect(catalogAnswerSource(null, { statement_html: MD_STATEMENT })).toBeNull()
  })

  it('формулы $…$, \dfrac, \mathbb{Z} и «;» рисуются KaTeX, исходник не виден', () => {
    const html = render(catalogAnswerSource(ANSWER, { statement_html: MD_STATEMENT })!)
    expect(html.match(/class="katex"/g)?.length).toBe(2)
    expect(html).toContain('mfrac')
    expect(html).toContain('mathbb')
    expect(html).toContain('; б)')
    expect(html).not.toContain('$')
  })

  it('resolveTaskHtml после хелпера отдаёт Markdown-рендер, без хелпера — сырой текст (сам баг)', () => {
    expect(resolveTaskHtml(ANSWER, [])).toContain(String.raw`$\pm`)
    expect(resolveTaskHtml(catalogAnswerSource(ANSWER, { statement_html: MD_STATEMENT }), [])).not.toContain(String.raw`$\pm`)
  })
})

describe('PDF варианта: «Ответы» и «Ключ»', () => {
  const item = (statement_html: string, answer_html: string): PrintableItem => ({
    id: 'i1', task: { id: 't1', statement_html, answer_html, has_answer: true, assets: [] } as never,
  })

  it('Markdown-задача: ответ в списке и в ключе — через Markdown', () => {
    const answers = buildAnswersList([item(MD_STATEMENT, ANSWER)], (h) => (isCatalogMarkdown(h) ? 'MD' : 'RAW'))
    expect(answers[0].answerHtml).toBe('MD')
    const key = buildKeyTable([item(MD_STATEMENT, ANSWER)])
    expect(isCatalogMarkdown(key[0].answerMarkdown)).toBe(true)
  })

  it('HTML-задача: ключ — простой текст, как раньше', () => {
    const key = buildKeyTable([item('<p>старая</p>', '<p>-1,6</p>')])
    expect(key[0]).toEqual({ itemId: 'i1', number: '1', shortAnswer: '-1,6' })
  })
})
