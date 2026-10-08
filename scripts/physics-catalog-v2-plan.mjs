/**
 * §269. Чистые функции загрузчика переписанного каталога физики ЕГЭ
 * (scripts/import-physics-catalog-v2.mjs). Сети и записи здесь нет — только
 * разбор папок КИМ01..КИМ26, сборка строк задачи и план «что с какой задачей
 * сделать». Покрыто тестами src/lib/__tests__/physicsCatalogV2Plan.test.ts.
 *
 * Решения (почему так — PROJECT_STATE §269):
 * • Задача, которая стоит хоть в одном варианте (`test_variant_items`, снимка
 *   там нет), на месте НЕ меняется: заводится новая строка с новым текстом
 *   (тот же раздел, темы, позиция; номер задачи — прежний), старая строка
 *   скрывается из каталога (is_published = false, external_id + 10⁹·k,
 *   origin_external_id = прежний номер, replaced_by_task_id = новая) — это
 *   делает функция базы `catalog_replace_task_v2` одной транзакцией.
 * • Остальные задачи меняются на месте по external_id (id прежний — прогресс,
 *   попытки и раскрытия учеников остаются при задаче).
 * • Тексты — Markdown + LaTeX в тех же колонках с меткой `<!--md-->` в начале,
 *   `content_format = 'md'`, ответ — `answer_spec` (jsonb) + строка для показа
 *   в `answer_html` (с настоящим минусом «−»).
 * • Рисунки — в публичный бакет `catalog-figures`, путь по содержимому файла
 *   (sha-256): повторная загрузка того же файла ничего не делает.
 */

import { createHash } from 'node:crypto'

export const SUBJECT = 'Физика'
export const EXAM_TYPE = 'ЕГЭ'
export const FIGURES_BUCKET = 'catalog-figures'
export const FIGURES_PREFIX = 'fizika-ege'
export const TASKS_FILE = 'задачи.json'
export const REPORT_FILE = 'загрузка_отчёт.json'
export const PLAN_FILE = 'загрузка_план.json'
export const MD_MARKER = '<!--md-->'
export const ARCHIVE_OFFSET = 1_000_000_000

const MINUS = '−'

/** «КИМ07» → 7; чужие папки — null. */
export function kimOfFolder(name) {
  const m = /^КИМ(\d{2})$/.exec(String(name ?? '').normalize('NFC'))
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= 26 ? n : null
}

// ── Ответ ─────────────────────────────────────────────────────────────────────

/**
 * Ответ из задачи.json → `answer_spec` базы (число — с точкой) или текст ошибки.
 * Варианты в данных: number {value:"-8" (десятичная запятая), tol}, digits
 * {text, any_order}, text {text}.
 */
export function normalizeAnswer(answer) {
  if (!answer || typeof answer !== 'object') return { error: 'нет ответа' }
  if (answer.type === 'number') {
    const value = String(answer.value ?? '').trim().replace(',', '.').replace(/^[−–—]/, '-')
    if (!/^-?\d+(\.\d+)?$/.test(value)) return { error: `число «${answer.value}» не разобрать` }
    const tol = answer.tol == null ? 0 : Number(answer.tol)
    if (!Number.isFinite(tol) || tol < 0) return { error: `допуск «${answer.tol}» не разобрать` }
    return { spec: { type: 'number', value: value === '-0' ? '0' : value, tol } }
  }
  if (answer.type === 'digits') {
    // «4,40,2» (КИМ 19: значение и погрешность подряд, как в бланке ЕГЭ) — тоже digits;
    // база проверяет такие тем же правилом, что и варианты (variant_answer_verdict).
    const text = String(answer.text ?? '').trim()
    if (!/^\d+(,\d+)*$/.test(text)) return { error: `цифры «${answer.text}» не разобрать` }
    if (text.includes(',') && answer.any_order === true) return { error: `«${answer.text}»: значение с погрешностью не может быть «в любом порядке»` }
    return { spec: { type: 'digits', text, any_order: answer.any_order === true } }
  }
  if (answer.type === 'text') {
    const text = String(answer.text ?? '').trim()
    if (!text) return { error: 'пустой текстовый ответ' }
    return { spec: { type: 'text', text } }
  }
  return { error: `неизвестный тип ответа «${answer.type}»` }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Ответ для показа (`answer_html`): «−8», «0,06», «145», «к наблюдателю». */
export function answerDisplay(spec) {
  if (spec.type === 'number') {
    const v = spec.value.replace('.', ',')
    return v.startsWith('-') ? MINUS + v.slice(1) : v
  }
  return escapeHtml(spec.text)
}

// Повтор правила базы (catalog_answer_spec_verdict) — только чтобы загрузчик
// убедился: эталон, показанный ученику, сам себя засчитывает.
function numberOf(raw) {
  const s = String(raw ?? '').replace(/[−–—]/g, '-').replace(/\s+/g, '').replace(',', '.').toLowerCase()
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null
}
function digitsOf(raw) {
  const s = String(raw ?? '').replace(/[\s,;.]/g, '')
  return /^\d+$/.test(s) ? s : null
}
const UPPER = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё'
const LOWER = 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе'
export function textKey(raw) {
  let s = ''
  for (const ch of String(raw ?? '')) {
    const i = UPPER.indexOf(ch)
    s += i >= 0 ? LOWER[i] : ch
  }
  return s.toLowerCase().replace(/[^0-9a-zа-я]/g, '')
}
/** Нормализация как normalize_variant_answer базы: минусы, запятая → точка, пробелы, регистр. */
export function normalizeVariantAnswer(raw) {
  return String(raw ?? '').replace(/[−–—]/g, '-').replace(/\u00a0/g, ' ').replace(/,/g, '.')
    .replace(/\s+/g, ' ').trim().toLowerCase()
}
const CANON = /^(0|[1-9]\d*)(\.\d+)?$/
/** Как variant_answer_value_error_pair: единственный разрез «значение|погрешность». */
export function valueErrorPair(correctNorm) {
  if (/^-?\d+(\.\d+)?$/.test(correctNorm)) return null
  const cuts = []
  for (let i = 1; i < correctNorm.length; i++) {
    const l = correctNorm.slice(0, i)
    const r = correctNorm.slice(i)
    if (CANON.test(l) && CANON.test(r) && Number(l) >= Number(r)) cuts.push([Number(l), Number(r)])
  }
  return cuts.length === 1 ? cuts[0] : null
}
/** Повтор ветки «значение и погрешность» variant_answer_verdict. */
export function valueErrorVerdict(text, raw) {
  const c = normalizeVariantAnswer(text)
  const st = normalizeVariantAnswer(raw)
  const pair = valueErrorPair(c)
  if (!pair) return st === c
  if (st === c) return true
  if (!/^\d+(\.\d+)?[ ;±]+\d+(\.\d+)?$/.test(st)) return false
  const [a, b] = st.split(/[ ;±]+/).map(Number)
  return a === pair[0] && b === pair[1]
}

export function specVerdict(spec, raw) {
  if (spec.type === 'number') {
    const n = numberOf(raw)
    if (n === null) return false
    // Сравнение в «копейках», чтобы 0,1 + 0,2 не подвело.
    const scale = 1e9
    return Math.abs(Math.round(n * scale) - Math.round(Number(spec.value) * scale)) <= Math.round((spec.tol ?? 0) * scale)
  }
  if (spec.type === 'digits' && !/^\d+$/.test(spec.text)) return valueErrorVerdict(spec.text, raw)
  if (spec.type === 'digits') {
    const d = digitsOf(raw)
    if (d === null) return false
    if (spec.any_order) return [...d].sort().join('') === [...spec.text].sort().join('')
    return d === spec.text
  }
  if (spec.type === 'text') {
    const k = textKey(raw)
    return k !== '' && k === textKey(spec.text)
  }
  return false
}

// ── Рисунки ───────────────────────────────────────────────────────────────────

export function contentTypeOf(name) {
  const ext = String(name).toLowerCase().split('.').pop()
  return { svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' }[ext] ?? null
}

/** Путь в бакете по содержимому: fizika-ege/<sha256:32>.svg */
export function figureStoragePath(fileName, bytes) {
  const ext = String(fileName).toLowerCase().split('.').pop()
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  return `${FIGURES_PREFIX}/${hash}.${ext}`
}

/** Строка Markdown с рисунком. */
export function figureLine(path, alt = 'Рисунок') {
  return `![${alt}](fig:${path})`
}

/** Рисунок условия — после первого абзаца (обычно «На рисунке показан…»). */
export function insertAfterFirstParagraph(md, line) {
  const text = String(md ?? '').replace(/\r\n?/g, '\n').trim()
  const m = /\n[ \t]*\n/.exec(text)
  if (!m) return `${text}\n\n${line}`
  return `${text.slice(0, m.index)}\n\n${line}\n\n${text.slice(m.index + m[0].length).trimStart()}`
}

// ── Задача → строка базы ──────────────────────────────────────────────────────

/**
 * Поля строки catalog_tasks из задачи. `figurePaths` — { 'fig/x.svg': 'fizika-ege/<hash>.svg' }.
 */
export function buildContent(task, figurePaths) {
  const { spec, error } = normalizeAnswer(task.answer)
  if (error) throw new Error(`${task.external_id}: ${error}`)
  let statement = String(task.statement ?? '').replace(/\r\n?/g, '\n').trim()
  if (task.figure) {
    const p = figurePaths[task.figure]
    if (!p) throw new Error(`${task.external_id}: нет пути для ${task.figure}`)
    statement = insertAfterFirstParagraph(statement, figureLine(p))
  }
  let solution = String(task.solution ?? '').replace(/\r\n?/g, '\n').trim()
  if (task.solution_figure) {
    const p = figurePaths[task.solution_figure]
    if (!p) throw new Error(`${task.external_id}: нет пути для ${task.solution_figure}`)
    solution = `${figureLine(p, 'Рисунок к решению')}\n\n${solution}`
  }
  return {
    content_format: 'md',
    statement_html: `${MD_MARKER}\n${statement}`,
    solution_html: solution ? `${MD_MARKER}\n${solution}` : null,
    answer_html: answerDisplay(spec),
    answer_spec: spec,
    has_answer: true,
    has_solution: solution !== '',
    // План решения у старых задач — со старыми числами: убираем.
    solution_plan_html: null,
  }
}

/** Проверка одной задачи из задачи.json; `hasFile(rel)` — есть ли файл в папке КИМ. */
export function validateTask(task, kim, hasFile) {
  const problems = []
  const id = String(task?.external_id ?? '')
  if (!/^\d+$/.test(id)) problems.push(`external_id «${task?.external_id}» — не число`)
  if (task?.kim !== kim) problems.push(`${id}: kim ${task?.kim}, а папка КИМ${String(kim).padStart(2, '0')}`)
  if (!String(task?.statement ?? '').trim()) problems.push(`${id}: пустое условие`)
  const { error } = normalizeAnswer(task?.answer)
  if (error) problems.push(`${id}: ${error}`)
  for (const key of ['figure', 'solution_figure']) {
    const f = task?.[key]
    if (f == null) continue
    if (typeof f !== 'string' || !/^fig\/[^/\\]+$/.test(f) || !contentTypeOf(f)) problems.push(`${id}: ${key} «${f}» — не fig/<имя>.svg|png|webp`)
    else if (!hasFile(f)) problems.push(`${id}: нет файла ${f}`)
  }
  return problems
}

// ── План ──────────────────────────────────────────────────────────────────────

function canonical(v) {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

const CONTENT_KEYS = ['content_format', 'statement_html', 'solution_html', 'answer_html', 'has_answer', 'has_solution', 'solution_plan_html']

/** Какие поля строки базы отличаются от новых (пустой список — ничего делать не надо). */
export function changedFields(dbRow, content) {
  const out = CONTENT_KEYS.filter(k => (dbRow[k] ?? null) !== (content[k] ?? null))
  if (canonical(dbRow.answer_spec ?? null) !== canonical(content.answer_spec)) out.push('answer_spec')
  return out
}

/**
 * План загрузки.
 *  tasks          — задачи из папок (с полем kim);
 *  contents       — Map external_id → buildContent(...);
 *  dbRows         — строки catalog_tasks физики ЕГЭ (id, external_id, kim — номер раздела,
 *                   exam_part, partial_type, is_published, replaced_by_task_id + поля CONTENT_KEYS, answer_spec);
 *  usedInVariants — Set id задач, стоящих в test_variant_items.
 */
export function planImport({ tasks, contents, dbRows, usedInVariants }) {
  const byExt = new Map()
  for (const r of dbRows) {
    if (r.replaced_by_task_id) continue // архивная (скрытая) копия — её номер со сдвигом
    byExt.set(String(r.external_id), r)
  }
  const items = []
  const anomalies = []
  for (const t of tasks) {
    const ext = String(t.external_id)
    const row = byExt.get(ext)
    const content = contents.get(ext)
    if (!row) {
      items.push({ external_id: ext, kim: t.kim, action: 'missing' })
      anomalies.push(`${ext} (КИМ ${t.kim}): нет в базе — пропущена`)
      continue
    }
    if (row.kim != null && row.kim !== t.kim) {
      anomalies.push(`${ext}: в данных КИМ ${t.kim}, в базе раздел №${row.kim} — раздел не меняется`)
    }
    const spec = content.answer_spec
    if (spec.type === 'text' && (row.exam_part ?? 1) !== 2) {
      anomalies.push(`${ext} (КИМ ${t.kim}): текстовый ответ в части 1 — поля проверки у ученика не будет (ответ открыт), как у части 2`)
    }
    if (spec.type === 'number' && row.partial_type) {
      anomalies.push(`${ext} (КИМ ${t.kim}): числовой ответ, а в базе partial_type=${row.partial_type} — в вариантах балл по цифрам`)
    }
    if (spec.type === 'digits' && spec.any_order === false && row.partial_type === 'multi_choice') {
      anomalies.push(`${ext} (КИМ ${t.kim}): цифры «по порядку», а в базе multi_choice (порядок не важен)`)
    }
    if (!row.is_published) anomalies.push(`${ext}: задача в базе скрыта (is_published = false) — останется скрытой`)
    if (!specVerdict(spec, content.answer_html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))) {
      anomalies.push(`${ext}: показанный ответ «${content.answer_html}» не засчитывается проверкой — проверьте ответ`)
    }
    const changes = changedFields(row, content)
    if (changes.length === 0) {
      items.push({ external_id: ext, kim: t.kim, action: 'unchanged', task_id: row.id })
    } else if (usedInVariants.has(row.id)) {
      items.push({ external_id: ext, kim: t.kim, action: 'fork', task_id: row.id, changes })
    } else {
      items.push({ external_id: ext, kim: t.kim, action: 'update', task_id: row.id, changes })
    }
  }
  const seen = new Set(tasks.map(t => String(t.external_id)))
  const notInData = [...byExt.values()].filter(r => !seen.has(String(r.external_id)))
  return { items, anomalies, notInData }
}

/** Сводка по КИМ: { [kim]: { total, update, fork, unchanged, missing } }. */
export function summarizePlan(items) {
  const per = {}
  for (const it of items) {
    const s = (per[it.kim] ??= { total: 0, update: 0, fork: 0, unchanged: 0, missing: 0 })
    s.total++
    s[it.action]++
  }
  const total = { total: 0, update: 0, fork: 0, unchanged: 0, missing: 0 }
  for (const s of Object.values(per)) for (const k of Object.keys(total)) total[k] += s[k]
  return { per, total }
}

/** Таблица сводки для лога. */
export function formatSummary({ per, total }) {
  const lines = ['  КИМ  всего  на месте  новой строкой  без изменений  нет в базе']
  for (const kim of Object.keys(per).map(Number).sort((a, b) => a - b)) {
    const s = per[kim]
    lines.push(`  ${String(kim).padStart(3)}  ${String(s.total).padStart(5)}  ${String(s.update).padStart(8)}  ${String(s.fork).padStart(13)}  ${String(s.unchanged).padStart(14)}  ${String(s.missing).padStart(10)}`)
  }
  lines.push(`  итог ${String(total.total).padStart(5)}  ${String(total.update).padStart(8)}  ${String(total.fork).padStart(13)}  ${String(total.unchanged).padStart(14)}  ${String(total.missing).padStart(10)}`)
  return lines
}

/** Тело для catalog_replace_task_v2 / обновления строки. */
export function rowPayload(content) {
  const out = {}
  for (const k of CONTENT_KEYS) out[k] = content[k] ?? null
  out.answer_spec = content.answer_spec
  return out
}
