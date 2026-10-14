/**
 * Чистые функции загрузчика переписанного каталога «Математика ЕГЭ»
 * (scripts/import-math-catalog-v2.mjs; письмо каталог_математика_загрузчик.md,
 * 14.10.2026). Сети и записи здесь нет. Покрыто тестами
 * src/lib/__tests__/mathCatalogV2Plan.test.ts.
 *
 * Формат папок и строк базы тот же, что у физики (§269), поэтому разбор
 * ответа, сборка строки, проверка задачи и план «на месте / новой строкой /
 * нет в базе» — общие, из physics-catalog-v2-plan.mjs, а не копией: правило
 * одно на оба предмета. Своё у математики:
 *  • предмет, экзамен, КИМ 1–19, папка рисунков в бакете `matematika-ege/`;
 *  • режим проверки у ученика. Его выставляет база (триггер
 *    catalog_tasks_auto_checkable → catalog_task_checkable): часть 2 — всегда
 *    самопроверка, часть 1 — автопроверка, если ответ разбирается правилами
 *    вариантов. Загрузчик флаг не пишет, а предсказывает его в плане: число в
 *    части 1 — автопроверка, часть 2 — самопроверка (даже с числовым ответом),
 *    текстовый ответ в части 1 — «решит база» (так «65,125» база засчитает как
 *    пару чисел, а «2/7» или «а) …; б) …» — нет). После --apply загрузчик
 *    перечитывает итоговый флаг из базы и пишет его в отчёт.
 *  • задачи на доказательство (КИМ01 141177, 141251 и т. п.): в данных ответ
 *    `{type:'text', text:''}`. У физики пустой ответ — ошибка; здесь это «ответа
 *    нет»: has_answer = false, answer_html и answer_spec — null (база это
 *    допускает), триггер ставит самопроверку. Новой строкой такую задачу
 *    завести нельзя (catalog_replace_task_v2 требует ответ) — если она стоит в
 *    варианте, это проблема файла, и --apply не начнётся.
 */

import { createHash } from 'node:crypto'
import { buildContent as buildPhysicsContent, planImport, validateTask as validatePhysicsTask } from './physics-catalog-v2-plan.mjs'

export {
  ARCHIVE_OFFSET, FIGURES_BUCKET, MD_MARKER, PLAN_FILE, REPORT_FILE, TASKS_FILE,
  answerDisplay, changedFields, contentTypeOf, figureLine, formatSummary,
  insertAfterFirstParagraph, normalizeAnswer, rowPayload, specVerdict, summarizePlan,
} from './physics-catalog-v2-plan.mjs'

export const SUBJECT = 'Математика'
export const EXAM_TYPE = 'ЕГЭ'
export const FIGURES_PREFIX = 'matematika-ege'
export const KIM_COUNT = 19

/** «КИМ07» → 7; чужие папки и номера вне 1–19 — null. */
export function kimOfFolder(name) {
  const m = /^КИМ(\d{2})$/.exec(String(name ?? '').normalize('NFC'))
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= KIM_COUNT ? n : null
}

/** Путь в бакете по содержимому: matematika-ege/<sha256:32>.svg */
export function figureStoragePath(fileName, bytes) {
  const ext = String(fileName).toLowerCase().split('.').pop()
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 32)
  return `${FIGURES_PREFIX}/${hash}.${ext}`
}

/** Задача на доказательство: ответа нет (в данных — пустой текстовый ответ). */
export function isProofTask(task) {
  const a = task?.answer
  return !!a && a.type === 'text' && String(a.text ?? '').trim() === ''
}

/** Заглушка ответа доказательства — только чтобы пройти общие проверки физики. */
const PROOF_STUB = { type: 'text', text: '—' }

/** Строка базы из задачи; у доказательства ответа нет. */
export function buildContent(task, figurePaths) {
  if (!isProofTask(task)) return buildPhysicsContent(task, figurePaths)
  const c = buildPhysicsContent({ ...task, answer: PROOF_STUB }, figurePaths)
  return { ...c, answer_html: null, answer_spec: null, has_answer: false }
}

/** Проверка задачи; у доказательства пустой ответ — не ошибка. */
export function validateTask(task, kim, hasFile) {
  if (!isProofTask(task)) return validatePhysicsTask(task, kim, hasFile)
  return validatePhysicsTask({ ...task, answer: PROOF_STUB }, kim, hasFile)
}

/**
 * Режим проверки у ученика после загрузки — оценка без базы:
 *  'auto' — поле ответа и «Проверить»;
 *  'self' — самопроверка («сверь с решением»): вся часть 2;
 *  'db'   — текстовый ответ в части 1: решит база по тексту ответа.
 */
export function checkModeOf(examPart, spec) {
  if ((examPart ?? 1) === 2 || !spec) return 'self'
  if (spec?.type === 'text') return 'db'
  return 'auto'
}

/**
 * План для математики: общий planImport + режим проверки по задачам, которые
 * есть в базе. Строку физики «текстовый ответ в части 1 — поля проверки не
 * будет» заменяем: у математики это решает база, и часть таких ответов она
 * засчитает.
 */
export function planMathImport({ tasks, contents, dbRows, usedInVariants }) {
  // Общему плану нужен ответ у каждой задачи — доказательствам даём заглушку
  // (на решение «на месте / новой строкой» она не влияет: формат меняется всё равно).
  const forPlan = new Map(contents)
  const proofs = new Set()
  for (const [ext, c] of contents) {
    if (c.answer_spec) continue
    proofs.add(ext)
    forPlan.set(ext, { ...c, answer_spec: PROOF_STUB, answer_html: PROOF_STUB.text })
  }
  const plan = planImport({ tasks, contents: forPlan, dbRows, usedInVariants })
  const proofProblems = plan.items
    .filter(it => proofs.has(it.external_id) && it.action === 'fork')
    .map(it => `${it.external_id} (КИМ ${it.kim}): доказательство без ответа стоит в варианте — новой строкой его не завести (нужен ответ)`)
  const rowByExt = new Map()
  for (const r of dbRows) if (!r.replaced_by_task_id) rowByExt.set(String(r.external_id), r)

  const per = {}
  const total = { auto: 0, self: 0, db: 0 }
  const decidedByDb = []
  const numberInPart2 = []
  for (const it of plan.items) {
    const row = rowByExt.get(it.external_id)
    if (!row) continue
    const spec = contents.get(it.external_id)?.answer_spec
    const mode = checkModeOf(row.exam_part, spec)
    ;(per[it.kim] ??= { auto: 0, self: 0, db: 0 })[mode]++
    total[mode]++
    if (mode === 'db') decidedByDb.push({ external_id: it.external_id, kim: it.kim, answer: spec.text })
    if (mode === 'self' && spec?.type === 'number') numberInPart2.push({ external_id: it.external_id, kim: it.kim })
  }

  const anomalies = plan.anomalies.filter(a => !a.includes('текстовый ответ в части 1')
    && ![...proofs].some(ext => a.startsWith(`${ext}:`) || a.startsWith(`${ext} (`)))
  if (proofs.size) anomalies.push(`${proofs.size} задач на доказательство — без ответа, самопроверка по решению`)
  for (const d of decidedByDb) {
    anomalies.push(`${d.external_id} (КИМ ${d.kim}): текстовый ответ «${d.answer}» в части 1 — автопроверку решит база по тексту ответа`)
  }
  if (numberInPart2.length) {
    anomalies.push(`${numberInPart2.length} задач с числовым ответом стоят в базе как часть 2 — по правилу базы будут самопроверкой (список — в плане, numberInPart2)`)
  }
  return { ...plan, anomalies, proofProblems, checkModes: { per, total, decidedByDb, numberInPart2 } }
}

/** Таблица режимов проверки для лога. */
export function formatCheckModes({ per, total }) {
  const lines = ['  КИМ  автопроверка  самопроверка  решит база']
  for (const kim of Object.keys(per).map(Number).sort((a, b) => a - b)) {
    const s = per[kim]
    lines.push(`  ${String(kim).padStart(3)}  ${String(s.auto).padStart(12)}  ${String(s.self).padStart(12)}  ${String(s.db).padStart(10)}`)
  }
  lines.push(`  итог ${String(total.auto).padStart(12)}  ${String(total.self).padStart(12)}  ${String(total.db).padStart(10)}`)
  return lines
}
