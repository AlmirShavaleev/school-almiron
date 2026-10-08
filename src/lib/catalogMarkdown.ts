/**
 * §269. Markdown + LaTeX задач каталога (переписанный каталог физики ЕГЭ).
 *
 * Новые задачи лежат в тех же колонках (`statement_html`, `solution_html`), но
 * текстом Markdown с формулами `$…$` / `$$…$$` и с меткой {@link CATALOG_MD_MARKER}
 * в начале. Метка в самом тексте, а не только в колонке `content_format`:
 * условие приходит в клиент десятком путей (каталог, варианты, тесты темы,
 * задача дня, PDF, функции базы с фиксированным набором полей) — по метке
 * формат узнаётся везде, где текст проходит через `resolveTaskHtml`, без
 * протаскивания колонки. Старые задачи (математика, физика ОГЭ) метки не имеют
 * и рисуются как раньше.
 *
 * Безопасность: HTML здесь собирается из ЭКРАНИРОВАННОГО текста — сырой HTML в
 * источнике показывается буквами. Картинки — только `![подпись](fig:путь)` из
 * бакета рисунков каталога (путь из [a-z0-9/_.-], расширение svg/png/webp/jpg),
 * через `<img>`: SVG в `<img>` скрипты не исполняет. Формулы — KaTeX с
 * `trust: false` (без \href, \url, \htmlClass и т. п.).
 *
 * KaTeX грузится лениво (см. `katexLoader.ts`): пока его нет, формула выходит
 * исходником в `<span class="catalog-math catalog-math-pending">`, и
 * `upgradeCatalogMath` дорисовывает её на месте, когда библиотека приехала.
 *
 * Подмножество Markdown — ровно то, что есть в данных: абзацы (пустая строка),
 * перенос строки внутри абзаца — `<br>` (строки «А) …», «1) …» идут подряд),
 * **жирный**, *курсив*, списки «- …» и «1. …», таблицы GFM, рисунки.
 */

export const CATALOG_MD_MARKER = '<!--md-->'

/** Есть ли у текста метка Markdown-формата (пробелы перед ней допустимы). */
export function isCatalogMarkdown(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.trimStart().startsWith(CATALOG_MD_MARKER)
}

/** Текст с меткой — так его пишет загрузчик. */
export function withCatalogMarkdownMarker(md: string): string {
  return `${CATALOG_MD_MARKER}\n${md}`
}

/** Текст без метки. */
export function stripCatalogMarkdownMarker(s: string): string {
  const t = s.trimStart()
  return t.startsWith(CATALOG_MD_MARKER) ? t.slice(CATALOG_MD_MARKER.length).replace(/^\r?\n/, '') : s
}

/** То, что нужно от KaTeX (настоящий модуль или заглушка в тестах). */
export interface KatexLike {
  renderToString(tex: string, options?: Record<string, unknown>): string
}

export const KATEX_OPTIONS = {
  throwOnError: false,
  strict: 'ignore',
  trust: false,
  output: 'htmlAndMathml',
} as const

export interface RenderCatalogMarkdownOptions {
  /** KaTeX, если уже загружен; иначе формулы выйдут «ждущими» исходниками. */
  katex?: KatexLike | null
  /** База публичных адресов рисунков (с завершающим «/» или без). */
  figureBaseUrl: string
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Путь рисунка, который разрешено подставить в `<img src>`. */
const FIGURE_PATH = /^[a-z0-9][a-z0-9/_.-]*\.(svg|png|webp|jpe?g)$/i
const FIGURE_LINE = /^!\[([^\]]*)\]\((?:fig:)?([^)\s]+)\)$/

export function figureUrl(base: string, path: string): string | null {
  if (!FIGURE_PATH.test(path) || path.includes('..') || path.includes('//')) return null
  return `${base.replace(/\/+$/, '')}/${path}`
}

// ── Формулы ────────────────────────────────────────────────────────────────────

interface MathPiece { tex: string; display: boolean }

/** Плейсхолдер формулы: символы, которых нет ни в тексте, ни после экранирования. */
const PH = (i: number) => `\u0000${i}\u0000`
// eslint-disable-next-line no-control-regex
const PH_RE = /\u0000(\d+)\u0000/g

/**
 * Вынимает формулы из текста до разбора Markdown — иначе `*`, `_` и `|` внутри
 * TeX приняли бы за разметку. `\$` — буквальный доллар. Незакрытый `$` остаётся
 * текстом. Внутристрочная формула не переходит через пустую строку.
 */
export function extractMath(src: string): { text: string; math: MathPiece[] } {
  const math: MathPiece[] = []
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\' && src[i + 1] === '$') { out += '$'; i += 2; continue }
    if (ch === '$') {
      const display = src[i + 1] === '$'
      const open = display ? 2 : 1
      let j = i + open
      let found = -1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '$') {
          if (!display) { found = j; break }
          if (src[j + 1] === '$') { found = j; break }
        }
        if (!display && src[j] === '\n' && src[j + 1] === '\n') break
        j++
      }
      const tex = found >= 0 ? src.slice(i + open, found) : ''
      if (found >= 0 && tex.trim() !== '') {
        math.push({ tex: tex.trim(), display })
        out += PH(math.length - 1)
        i = found + open
        continue
      }
    }
    out += ch
    i++
  }
  return { text: out, math }
}

function renderMath(piece: MathPiece, katex: KatexLike | null | undefined): string {
  if (katex) {
    try {
      return katex.renderToString(piece.tex, { ...KATEX_OPTIONS, displayMode: piece.display })
    } catch {
      // throwOnError: false и так не бросает; на всякий случай — исходник.
    }
  }
  const cls = piece.display ? 'catalog-math catalog-math-pending catalog-math-display' : 'catalog-math catalog-math-pending'
  return `<span class="${cls}">${escapeHtml(piece.tex)}</span>`
}

// ── Строчная разметка ─────────────────────────────────────────────────────────

/** Экранирует текст и ставит **жирный** / *курсив*. Плейсхолдеры формул не трогает. */
function inline(text: string): string {
  let s = escapeHtml(text)
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>')
  return s
}

// ── Блоки ─────────────────────────────────────────────────────────────────────

const TABLE_ROW = /^\s*\|.*\|\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const BULLET = /^\s*[-*•]\s+(.*)$/
const ORDERED = /^\s*(\d{1,3})\.\s+(.*)$/

function splitCells(row: string): string[] {
  let r = row.trim()
  if (r.startsWith('|')) r = r.slice(1)
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < r.length; i++) {
    if (r[i] === '\\' && r[i + 1] === '|') { cur += '|'; i++; continue }
    if (r[i] === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += r[i]
  }
  cells.push(cur.trim())
  return cells
}

function renderTable(lines: string[]): string {
  const head = splitCells(lines[0])
  const body = lines.slice(2).map(splitCells)
  const th = head.map(c => `<th>${inline(c)}</th>`).join('')
  const rows = body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
  return `<div class="tbl-wrap"><table><thead><tr>${th}</tr></thead>${rows ? `<tbody>${rows}</tbody>` : ''}</table></div>`
}

type Segment =
  | { kind: 'table'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[]; start: number }
  | { kind: 'figure'; alt: string; path: string }
  | { kind: 'text'; lines: string[] }

function segmentBlock(lines: string[]): Segment[] {
  const segs: Segment[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const t = [line, lines[i + 1]]
      i += 2
      while (i < lines.length && TABLE_ROW.test(lines[i])) t.push(lines[i++])
      segs.push({ kind: 'table', lines: t })
      continue
    }
    const fig = FIGURE_LINE.exec(line.trim())
    if (fig) {
      segs.push({ kind: 'figure', alt: fig[1], path: fig[2] })
      i++
      continue
    }
    const b = BULLET.exec(line)
    const o = b ? null : ORDERED.exec(line)
    if (b || o) {
      const kind = b ? 'ul' : 'ol'
      const re = b ? BULLET : ORDERED
      const items: string[] = []
      const start = o ? Number(o[1]) : 1
      while (i < lines.length) {
        const m = re.exec(lines[i])
        if (m) { items.push(b ? m[1] : m[2]); i++; continue }
        // Продолжение пункта — строка с отступом.
        if (/^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += `\n${lines[i].trim()}`; i++; continue }
        break
      }
      segs.push({ kind, items, start })
      continue
    }
    const last = segs[segs.length - 1]
    if (last && last.kind === 'text') last.lines.push(line)
    else segs.push({ kind: 'text', lines: [line] })
    i++
  }
  return segs
}

function renderSegment(seg: Segment, figureBaseUrl: string): string {
  switch (seg.kind) {
    case 'table':
      return renderTable(seg.lines)
    case 'ul':
      return `<ul>${seg.items.map(it => `<li>${it.split('\n').map(inline).join('<br>')}</li>`).join('')}</ul>`
    case 'ol':
      return `<ol${seg.start !== 1 ? ` start="${seg.start}"` : ''}>${seg.items.map(it => `<li>${it.split('\n').map(inline).join('<br>')}</li>`).join('')}</ol>`
    case 'figure': {
      const url = figureUrl(figureBaseUrl, seg.path)
      if (!url) return `<p>${inline(`![${seg.alt}](${seg.path})`)}</p>`
      return `<p class="catalog-md-figure"><img src="${escapeHtml(url)}" alt="${escapeHtml(seg.alt || 'Рисунок')}" class="catalog-condition-figure" loading="lazy" decoding="async"></p>`
    }
    case 'text': {
      // eslint-disable-next-line no-control-regex
      const only = seg.lines.length === 1 ? /^\s*\u0000(\d+)\u0000\s*$/.exec(seg.lines[0]) : null
      if (only) return `<div class="catalog-math-block">${PH(Number(only[1]))}</div>`
      return `<p>${seg.lines.map(l => inline(l.trim())).join('<br>')}</p>`
    }
  }
}

/**
 * Markdown задачи → безопасный HTML (обёртка `<div class="catalog-md">`).
 * Метка в начале допустима и снимается.
 */
export function renderCatalogMarkdown(source: string, opts: RenderCatalogMarkdownOptions): string {
  const src = stripCatalogMarkdownMarker(source ?? '').replace(/\r\n?/g, '\n')
  const { text, math } = extractMath(src)
  const blocks = text.split(/\n[ \t]*\n+/).map(b => b.split('\n')).filter(b => b.some(l => l.trim() !== ''))
  const html = blocks
    .map(b => segmentBlock(b.filter((l, i, a) => !(l.trim() === '' && (i === 0 || i === a.length - 1)))))
    .flat()
    .map(seg => renderSegment(seg, opts.figureBaseUrl))
    .join('')
  const withMath = html.replace(PH_RE, (_, n: string) => {
    const piece = math[Number(n)]
    return piece ? renderMath(piece, opts.katex) : ''
  })
  return `<div class="catalog-md">${withMath}</div>`
}

/** Есть ли в готовом HTML формулы, ждущие KaTeX. */
export function hasPendingMath(html: string | null | undefined): boolean {
  return typeof html === 'string' && html.includes('catalog-math-pending')
}

/**
 * Дорисовывает «ждущие» формулы внутри `root` (после того как KaTeX загрузился).
 * Исходник берётся из textContent узла — т. е. уже без экранирования.
 */
export function upgradeCatalogMath(root: ParentNode | null | undefined, katex: KatexLike): number {
  if (!root) return 0
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.catalog-math-pending'))
  for (const el of nodes) {
    const tex = el.textContent ?? ''
    const display = el.classList.contains('catalog-math-display')
    el.innerHTML = katex.renderToString(tex, { ...KATEX_OPTIONS, displayMode: display })
    el.classList.remove('catalog-math-pending')
  }
  return nodes.length
}
