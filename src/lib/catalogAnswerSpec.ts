/**
 * §269. Ответ задачи переписанного каталога (колонка `catalog_tasks.answer_spec`).
 *
 *   { type: 'number', value: '-8', tol: 0 }          — число; value с точкой
 *   { type: 'digits', text: '145', any_order: true }  — цифры (порядок важен / нет);
 *     «4,40,2» — значение и погрешность подряд (КИМ 19), как в бланке
 *   { type: 'text',   text: 'к наблюдателю' }          — слова
 *
 * Проверяет ответ ТОЛЬКО база (`catalog_answer_spec_verdict` в
 * `catalog_check_answer`, `submit_variant`, …): эталон ученику до раскрытия не
 * отдаётся, колонка закрыта правами (§262). Здесь — только показ: ответ с
 * настоящим минусом «−» и запятой, а персоналу — строка допуска «засчитываем
 * от X до Y» (ученику допуск не показывается никогда).
 */

export type AnswerSpec =
  | { type: 'number'; value: string; tol?: number | null }
  | { type: 'digits'; text: string; any_order?: boolean | null }
  | { type: 'text'; text: string }

export const MINUS = '−'

/** Разбор `answer_spec` из базы; чужое/битое — null. */
export function parseAnswerSpec(raw: unknown): AnswerSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.type === 'number' && (typeof r.value === 'string' || typeof r.value === 'number')) {
    const value = String(r.value).replace(',', '.').replace(/^[−–—]/, '-').trim()
    if (!/^-?\d+(\.\d+)?$/.test(value)) return null
    const tol = typeof r.tol === 'number' ? r.tol : Number(r.tol ?? 0)
    return { type: 'number', value, tol: Number.isFinite(tol) && tol > 0 ? tol : 0 }
  }
  if (r.type === 'digits' && typeof r.text === 'string' && /^\d+(,\d+)*$/.test(r.text)) {
    return { type: 'digits', text: r.text, any_order: r.any_order === true }
  }
  if (r.type === 'text' && typeof r.text === 'string' && r.text.trim()) {
    return { type: 'text', text: r.text.trim() }
  }
  return null
}

/** Число для человека: «−0,6», «12». */
export function formatAnswerNumber(value: string): string {
  const v = value.trim().replace('.', ',')
  return v.startsWith('-') ? MINUS + v.slice(1) : v
}

/** Ответ для показа (он же пишется в `answer_html` загрузчиком). */
export function formatAnswerDisplay(spec: AnswerSpec): string {
  if (spec.type === 'number') return formatAnswerNumber(spec.value)
  return spec.text
}

function decimals(s: string): number {
  const m = /\.(\d+)$/.exec(s)
  return m ? m[1].length : 0
}

/** Сумма в десятичной арифметике без хвостов float: value ± tol. */
function addDecimal(value: string, delta: number): string {
  const dv = decimals(value)
  const dt = decimals(String(delta))
  const d = Math.max(dv, dt)
  const scale = 10 ** d
  const sum = Math.round(Number(value) * scale) + Math.round(delta * scale)
  const neg = sum < 0
  const abs = String(Math.abs(sum)).padStart(d + 1, '0')
  const out = d > 0 ? `${abs.slice(0, abs.length - d)}.${abs.slice(abs.length - d)}` : abs
  return (neg && Number(out) !== 0 ? '-' : '') + out
}

/** Границы допуска числа или null (допуска нет). */
export function toleranceRange(spec: AnswerSpec | null): { from: string; to: string } | null {
  if (!spec || spec.type !== 'number' || !spec.tol || spec.tol <= 0) return null
  return {
    from: formatAnswerNumber(addDecimal(spec.value, -spec.tol)),
    to: formatAnswerNumber(addDecimal(spec.value, spec.tol)),
  }
}

/** Строка для персонала под ответом: «засчитываем от 7,9 до 8,1»; без допуска — null. */
export function toleranceLine(spec: AnswerSpec | null): string | null {
  const r = toleranceRange(spec)
  return r ? `засчитываем от ${r.from} до ${r.to}` : null
}

/** Пояснение к цифровому ответу без порядка — персоналу. */
export function digitsOrderNote(spec: AnswerSpec | null): string | null {
  return spec && spec.type === 'digits' && spec.any_order ? 'цифры в любом порядке' : null
}

// ── Шапка задачи переписанного каталога ─────────────────────────────────────────

/** Сдвиг номера у скрытой старой строки (catalog_replace_task_v2: external_id + 10⁹·k). */
export const ARCHIVE_EXTERNAL_ID_OFFSET = 1_000_000_000

/** Код задачи для показа: «#96090» (у скрытой старой строки — её прежний номер). */
export function taskCodeLabel(externalId: number | string | null | undefined): string | null {
  const n = Number(externalId)
  if (!Number.isFinite(n) || n <= 0) return null
  return `#${n >= ARCHIVE_EXTERNAL_ID_OFFSET ? n % ARCHIVE_EXTERNAL_ID_OFFSET : n}`
}

/** «Задание 7 ЕГЭ» вместо «КИМ 7» (решение владельца §269). */
export function examTaskLabel(examNumber: number | null | undefined, examType: string | null | undefined): string | null {
  if (!examNumber || examNumber < 1) return null
  return `Задание ${examNumber} ${examType || 'ЕГЭ'}`
}

/** Ответ-число в показе — с настоящим минусом: «-1,6» → «−1,6» (только простая строка-число). */
export function withRealMinus(answer: string | null | undefined): string | null | undefined {
  if (!answer) return answer
  return /^\s*-\d[\d\s.,]*$/.test(answer) ? answer.replace('-', MINUS) : answer
}
