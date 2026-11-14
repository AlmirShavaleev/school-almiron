/**
 * Теория темы страницей, а не только PDF.
 *
 * Источник — тот же `src/теория.md`, из которого собирается PDF темы
 * («Математика ЕГЭ, 1 часть»). Загрузчик кладёт его в материал темы
 * `kind = 'text'`, `section = 'theory'` с меткой {@link THEORY_MD_MARKER} в
 * начале, рисунки — в бакет `catalog-figures` строками `![подпись](fig:путь)`.
 * Отдельной таблицы нет намеренно: материал темы уже копируется из шаблона в
 * курсы классов, подчиняется правам ученика и режиму контрольной.
 *
 * Разметка источника (её же понимает сборка PDF):
 *   `## Т1. Заголовок`             — раздел (номер «Т1.» на странице не нужен);
 *   `::: rule` … `:::`             — рамка: формула или правило;
 *   `::: example` … `:::`          — пример с решением;
 *   `::: trap` … `:::`             — ловушка ЕГЭ;
 *   `::: remember` … `:::`         — «запомни»;
 *   `::: check` вопрос `||` ответ `:::` — «Проверь себя»;
 *   `![подпись](fig:путь)`         — рисунок с подписью (отдельным абзацем).
 * Всё остальное — Markdown задач каталога (`catalogMarkdown.ts`): абзацы,
 * списки, таблицы, **жирный**, *курсив*, формулы `$…$` / `$$…$$`.
 *
 * Здесь только разбор на блоки — чистая функция, её гоняет vitest. HTML
 * каждого блока строит `renderCatalogMarkdown` (экранирование, KaTeX без trust,
 * рисунки только из бакета каталога) — второго рендера Markdown не заводим.
 */

export const THEORY_MD_MARKER = '<!--theory-->'

/** Текст материала — теория в Markdown (по метке в начале, пробелы перед ней допустимы). */
export function isTheoryMarkdown(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trimStart().startsWith(THEORY_MD_MARKER)
}

export type TheoryBoxKind = 'rule' | 'example' | 'trap' | 'remember'

export interface TheoryFigure {
  caption: string
  path: string
}

export type TheoryBlock =
  | { type: 'md'; md: string }
  | { type: 'figures'; items: TheoryFigure[] }
  | { type: 'box'; box: TheoryBoxKind; md: string }
  | { type: 'check'; question: string; answer: string }

export interface TheorySection {
  /** Заголовок раздела без номера «Т1.»; null — текст до первого раздела. */
  title: string | null
  blocks: TheoryBlock[]
}

const BOX_KINDS: readonly TheoryBoxKind[] = ['rule', 'example', 'trap', 'remember']
const HEADING = /^##\s+(.+?)\s*$/
const FENCE_OPEN = /^:::\s*([a-z]+)\s*$/
const FENCE_CLOSE = /^:::\s*$/
/** Абзац из одних строк-рисунков. Подпись без «]», путь без пробелов и «)». */
const FIGURE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)\)$/

/** «Т1. Название» → «Название». Номер раздела нужен PDF-оглавлению, не странице. */
export function stripSectionNumber(title: string): string {
  return title.replace(/^[ТT]\d+\.\s*/, '').trim()
}

function stripMarker(source: string): string {
  const t = source.replace(/\r\n?/g, '\n').trimStart()
  return t.startsWith(THEORY_MD_MARKER) ? t.slice(THEORY_MD_MARKER.length) : t
}

/** YAML-шапка `---` … `---` в начале исходника (title, zadanie) — странице не нужна. */
function stripFrontMatter(src: string): string {
  const m = /^\s*---\n[\s\S]*?\n---\s*(\n|$)/.exec(src)
  return m ? src.slice(m[0].length) : src
}

/** Текст вне рамок → блоки: абзацы из одних рисунков становятся рядом рисунков. */
function textBlocks(text: string): TheoryBlock[] {
  const out: TheoryBlock[] = []
  let md: string[] = []
  const flush = () => {
    const s = md.join('\n\n').trim()
    if (s) out.push({ type: 'md', md: s })
    md = []
  }
  for (const para of text.split(/\n[ \t]*\n+/)) {
    const lines = para.split('\n').map(l => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const figs = lines.map(l => FIGURE_ONLY.exec(l))
    if (figs.every(Boolean)) {
      flush()
      const items = figs.map(m => ({ caption: m![1].trim(), path: m![2] }))
      const last = out[out.length - 1]
      // Рисунки подряд (абзац за абзацем) — один ряд, как в PDF.
      if (last && last.type === 'figures') last.items.push(...items)
      else out.push({ type: 'figures', items })
    } else {
      md.push(para)
    }
  }
  flush()
  return out
}

function fenceBlock(kind: string, inner: string): TheoryBlock | null {
  const body = inner.trim()
  if (!body) return null
  if (kind === 'check') {
    const i = body.indexOf('||')
    const question = (i >= 0 ? body.slice(0, i) : body).trim()
    const answer = i >= 0 ? body.slice(i + 2).trim() : ''
    return { type: 'check', question, answer }
  }
  const box = (BOX_KINDS as readonly string[]).includes(kind) ? (kind as TheoryBoxKind) : 'rule'
  return { type: 'box', box, md: body }
}

/** Исходник теории → разделы с блоками. Незакрытая рамка тянется до конца раздела. */
export function parseTheory(source: string | null | undefined): TheorySection[] {
  const src = stripFrontMatter(stripMarker(source ?? ''))
  const sections: TheorySection[] = []
  let cur: TheorySection = { title: null, blocks: [] }
  let text: string[] = []
  let fence: { kind: string; lines: string[] } | null = null

  const flushText = () => {
    cur.blocks.push(...textBlocks(text.join('\n')))
    text = []
  }
  const closeFence = () => {
    if (!fence) return
    const b = fenceBlock(fence.kind, fence.lines.join('\n'))
    if (b) cur.blocks.push(b)
    fence = null
  }
  const closeSection = () => {
    closeFence()
    flushText()
    if (cur.title !== null || cur.blocks.length) sections.push(cur)
  }

  for (const line of src.split('\n')) {
    if (fence) {
      if (FENCE_CLOSE.test(line)) closeFence()
      else if (HEADING.test(line)) {
        // Забыли закрыть рамку — новый раздел её закрывает.
        closeSection()
        cur = { title: stripSectionNumber(HEADING.exec(line)![1]), blocks: [] }
      } else fence.lines.push(line)
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      closeSection()
      cur = { title: stripSectionNumber(h[1]), blocks: [] }
      continue
    }
    const f = FENCE_OPEN.exec(line)
    if (f) {
      flushText()
      fence = { kind: f[1], lines: [] }
      continue
    }
    text.push(line)
  }
  closeSection()
  return sections
}

/** Подпись над рамкой. У примера и «запомни» подписи нет, если текст уже начинается с неё. */
export function boxLabel(box: TheoryBoxKind, md: string): string | null {
  const head = md.trimStart()
  switch (box) {
    case 'rule':
      return null
    case 'example':
      return /^\*\*Пример/.test(head) ? null : 'Пример'
    case 'remember':
      return /^\*\*Запомни/.test(head) ? null : 'Запомни'
    case 'trap':
      return /^\*\*Ловушка/.test(head) ? null : 'Ловушка ЕГЭ'
  }
}
