/**
 * autocheck-plan.mjs — чистая часть загрузчика задач с автопроверкой (§266).
 * Ни сети, ни диска: всё, что нужно, передаётся аргументами, — поэтому её
 * гоняет vitest (src/lib/__tests__/autocheckPlan.test.ts).
 *
 * Папка темы `автопроверка/` (её готовит чат курса):
 *
 *   автопроверка/
 *     задачи.json
 *     01_условие.svg   01_решение.svg
 *     02_условие.svg   02_решение.svg   …
 *
 * задачи.json:
 *   {
 *     "topic": "1.4.1",
 *     "tasks": [
 *       { "code": "1.4.1-Д-01", "n": 1,
 *         "statement": "01_условие.svg", "solution": "01_решение.svg",
 *         "answer": { "type": "number", "value": 100, "tol": 0, "unit": "м" } },
 *       { "code": "1.4.1-Д-04", "n": 4,
 *         "statement": "04_условие.svg", "solution": "04_решение.svg",
 *         "answer": { "type": "digits", "text": "31", "any_order": true } }
 *     ]
 *   }
 *
 * Правила (их же проверяет база — topic_autocheck_import; здесь — раньше и
 * понятнее, до загрузки файлов):
 *  - code — непустая строка ≤ 64 символов, уникальная в файле; по ней повторная
 *    загрузка ОБНОВЛЯЕТ задачу, а не заводит вторую;
 *  - n — целое ≥ 1, уникальное: порядок задач в уроке;
 *  - statement — обязателен, solution — желателен (без решения ученик после
 *    закрытия задачи увидит только ответ); файлы .svg или .png рядом с json;
 *  - answer.type = "number": value — число (JSON-число, не строка), tol — число
 *    ≥ 0 (по умолчанию 0; абсолютный допуск), unit — строка ≤ 40 или нет;
 *  - answer.type = "digits": text — строка из цифр («31», «2413»), any_order —
 *    true/false (по умолчанию false: порядок важен, как в «соответствии»).
 */

import { createHash } from 'crypto'

export const AUTOCHECK_BUCKET = 'topic-autocheck'
export const TASKS_FILE = 'задачи.json'

const IMAGE_EXT = /\.(svg|png)$/i

export function contentTypeOf(fileName) {
  return /\.png$/i.test(fileName) ? 'image/png' : 'image/svg+xml'
}

/**
 * Путь в бакете — по содержимому файла: `<урок>/<sha256[:16]>.<ext>`.
 * Тот же файл → тот же путь (повторная загрузка ничего не льёт заново);
 * исправленный файл → новый путь (старая ссылка у учеников не подменяется
 * молча под открытой страницей). Имя без кириллицы: ключи Storage — ASCII.
 */
export function storagePathFor(topicId, fileName, bytes) {
  const ext = (fileName.match(IMAGE_EXT)?.[1] ?? 'svg').toLowerCase()
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  return `${topicId}/${hash}.${ext}`
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Разбор и проверка задачи.json. Возвращает { topic, tasks, problems, warnings }.
 * tasks — нормализованные: { code, n, statement, solution, answerType, value,
 * tol, text, anyOrder, unit }. Файлы на диске здесь не проверяются — это
 * `missingFiles`.
 */
export function parseTasksJson(text) {
  const problems = []
  const warnings = []
  let json
  try {
    json = JSON.parse(text)
  } catch (e) {
    return { topic: null, tasks: [], problems: [`${TASKS_FILE}: не JSON (${e instanceof Error ? e.message : e})`], warnings }
  }
  if (!isPlainObject(json)) return { topic: null, tasks: [], problems: [`${TASKS_FILE}: ожидался объект { topic, tasks }`], warnings }
  const topic = typeof json.topic === 'string' ? json.topic.trim() : null
  if (!topic) warnings.push('нет поля "topic" (номер подтемы) — сверить урок по названию не получится')
  if (!Array.isArray(json.tasks) || json.tasks.length === 0) {
    return { topic, tasks: [], problems: [`${TASKS_FILE}: "tasks" — непустой массив`], warnings }
  }

  const tasks = []
  const codes = new Set()
  const ns = new Set()
  json.tasks.forEach((t, i) => {
    const where = `задача ${i + 1}`
    if (!isPlainObject(t)) { problems.push(`${where}: ожидался объект`); return }
    const code = typeof t.code === 'string' ? t.code.trim() : ''
    const label = code ? `${where} (${code})` : where
    if (!code || code.length > 64) problems.push(`${label}: "code" — непустая строка до 64 символов`)
    else if (codes.has(code)) problems.push(`${label}: код повторяется`)
    else codes.add(code)

    const n = t.n
    if (!Number.isInteger(n) || n < 1) problems.push(`${label}: "n" — целое число от 1`)
    else if (ns.has(n)) problems.push(`${label}: номер n = ${n} повторяется`)
    else ns.add(n)

    const statement = typeof t.statement === 'string' ? t.statement.trim() : ''
    if (!statement) problems.push(`${label}: нет "statement" (файл условия)`)
    else if (!IMAGE_EXT.test(statement)) problems.push(`${label}: условие «${statement}» — не .svg/.png`)
    const solution = typeof t.solution === 'string' && t.solution.trim() ? t.solution.trim() : null
    if (!solution) warnings.push(`${label}: нет "solution" — после закрытия ученик увидит только ответ`)
    else if (!IMAGE_EXT.test(solution)) problems.push(`${label}: решение «${solution}» — не .svg/.png`)

    const a = t.answer
    if (!isPlainObject(a)) { problems.push(`${label}: нет "answer"`); return }
    const unit = a.unit === undefined || a.unit === null || a.unit === '' ? null : a.unit
    if (unit !== null && (typeof unit !== 'string' || unit.length > 40)) problems.push(`${label}: "unit" — строка до 40 символов`)

    if (a.type === 'number') {
      if (typeof a.value !== 'number' || !Number.isFinite(a.value)) {
        problems.push(`${label}: "answer.value" — число (JSON-число, не строка)`)
      }
      const tol = a.tol === undefined || a.tol === null ? 0 : a.tol
      if (typeof tol !== 'number' || !Number.isFinite(tol) || tol < 0) problems.push(`${label}: "answer.tol" — число ≥ 0`)
      if (a.text !== undefined) warnings.push(`${label}: у числового ответа поле "text" не используется`)
      tasks.push({ code, n, statement, solution, answerType: 'number', value: a.value, tol, text: null, anyOrder: false, unit })
    } else if (a.type === 'digits') {
      if (typeof a.text !== 'string' || !/^[0-9]+$/.test(a.text)) problems.push(`${label}: "answer.text" — строка из цифр, например "31"`)
      if (a.any_order !== undefined && typeof a.any_order !== 'boolean') problems.push(`${label}: "answer.any_order" — true или false`)
      if (unit !== null) warnings.push(`${label}: у ответа из цифр единица «${unit}» не показывается осмысленно`)
      tasks.push({ code, n, statement, solution, answerType: 'digits', value: null, tol: 0, text: a.text, anyOrder: a.any_order === true, unit })
    } else {
      problems.push(`${label}: "answer.type" — "number" или "digits"`)
    }
  })

  tasks.sort((x, y) => x.n - y.n)
  return { topic, tasks, problems, warnings }
}

/** Файлы, на которые ссылается план, но которых нет в папке (`has(name)` — есть ли файл). */
export function missingFiles(tasks, has) {
  const out = []
  for (const t of tasks) {
    if (t.statement && !has(t.statement)) out.push(t.statement)
    if (t.solution && !has(t.solution)) out.push(t.solution)
  }
  return [...new Set(out)]
}

/**
 * Строки для RPC topic_autocheck_import. `pathOf(fileName)` — путь в бакете
 * (после `storagePathFor` по содержимому).
 */
export function importRows(tasks, pathOf) {
  return tasks.map(t => ({
    code: t.code,
    position: t.n,
    statement_path: pathOf(t.statement),
    solution_path: t.solution ? pathOf(t.solution) : null,
    answer_type: t.answerType,
    answer_value: t.answerType === 'number' ? t.value : null,
    answer_tol: t.answerType === 'number' ? t.tol : 0,
    answer_text: t.answerType === 'digits' ? t.text : null,
    digits_any_order: t.answerType === 'digits' ? t.anyOrder : false,
    unit: t.unit,
  }))
}

/** Совпадает ли номер подтемы из json с названием урока («1.4.1 Скорость…»). */
export function topicMatchesTitle(topic, title) {
  if (!topic || !title) return true
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // «1.4.1 Скорость…» — да; «1.4.10 …» — нет (после номера пробел или конец).
  return new RegExp(`^${escaped}(?:[\\s\\u00a0]|$)`).test(String(title).trim())
}
