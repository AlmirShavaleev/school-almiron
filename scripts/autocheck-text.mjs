/**
 * autocheck-text.mjs — §278. Условия и решения задач с автопроверкой ТЕКСТОМ
 * (Markdown + LaTeX) из `дз.md` темы — вместо картинок-SVG.
 *
 * Чистая часть: ни сети, ни диска (тесты — src/lib/__tests__/autocheckText.test.ts).
 *
 * Формат задачи в `дз.md` (его ведёт чат курса):
 *
 *   ### Задача 2.16-Д-03
 *   - тип: …
 *   - рисунок: рисунки/2.16-Д-03.svg          (необязательно; рисунок решения)
 *   - рисунок-условие: рисунки/…-условие.svg  (необязательно; «нет» — без рисунка; по умолчанию = рисунок)
 *
 *   **Условие.** …
 *
 *   **Ответ:** 50 м
 *
 *   **Дано:** …
 *   **Найти:** …
 *
 *   **Решение.**
 *   1. **Шаг.** …
 *
 * Результат по задаче: statement_md = текст условия (+ рисунок условия),
 * solution_md = «Дано/Найти» (+ рисунок решения) + «Решение» + строка «Ответ».
 * Рисунок в тексте — `![](fig:<путь в бакете>)`; путь даёт `figurePath(rel)`.
 */

/** Задачи файла: код → кусок текста после заголовка. */
export function splitTasks(md) {
  const body = md.replace(/<!--[\s\S]*?-->/g, '')
  const out = new Map()
  const parts = body.split(/^### Задача\s+/m).slice(1)
  for (const p of parts) {
    const nl = p.indexOf('\n')
    const code = (nl < 0 ? p : p.slice(0, nl)).trim()
    if (code) out.set(code, nl < 0 ? '' : p.slice(nl + 1))
  }
  return out
}

/** Метаданные «- ключ: значение» в начале куска. */
export function taskMeta(chunk) {
  const meta = {}
  for (const line of chunk.split(/\r?\n/)) {
    const m = line.match(/^-\s+([^:]+):\s*(.*)$/)
    if (m) meta[m[1].trim()] = m[2].trim()
    else if (line.trim() === '') continue
    else break
  }
  return meta
}

const tidy = s => s.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()

/**
 * Тексты одной задачи. `figure(rel)` → путь рисунка в бакете (или null — без рисунка).
 * Возвращает null, если в куске нет «Условия» или «Ответа».
 */
export function taskText(chunk, figure) {
  const meta = taskMeta(chunk)
  const cond = chunk.match(/\*\*Условие\.\*\*\s*([\s\S]*?)\n\s*\n\*\*Ответ:\*\*/)
  const ans = chunk.match(/\*\*Ответ:\*\*\s*(.+)/)
  if (!cond || !ans) return null

  const solFig = meta['рисунок'] && meta['рисунок'] !== 'нет' ? meta['рисунок'] : null
  const condFigRaw = meta['рисунок-условие'] ?? solFig
  const condFig = condFigRaw && condFigRaw !== 'нет' ? condFigRaw : null
  const img = rel => {
    const p = rel ? figure(rel) : null
    return p ? `![](fig:${p})` : ''
  }

  let statement = tidy(cond[1])
  const ci = img(condFig)
  if (ci) statement += `\n\n${ci}`

  // Решение: от «Дано» (или «Решение», если «Дано» нет) до конца куска.
  const afterAnswer = chunk.slice(chunk.indexOf(ans[0]) + ans[0].length)
  const danoAt = afterAnswer.search(/\*\*Дано:\*\*/)
  const solAt = afterAnswer.search(/\*\*Решение\.\*\*/)
  let given = ''
  let steps = ''
  if (solAt >= 0) {
    given = danoAt >= 0 && danoAt < solAt ? afterAnswer.slice(danoAt, solAt) : ''
    steps = afterAnswer.slice(solAt)
  } else if (danoAt >= 0) {
    given = afterAnswer.slice(danoAt)
  }
  const parts = []
  if (tidy(given)) parts.push(tidy(given))
  const si = img(solFig)
  if (si) parts.push(si)
  if (tidy(steps)) parts.push(tidy(steps))
  parts.push(`**Ответ:** ${ans[1].trim()}`)
  return { statement_md: statement, solution_md: parts.join('\n\n'), figures: [condFig, solFig].filter(Boolean) }
}

/** Все рисунки, которые понадобятся задачам (для загрузки в бакет). */
export function figuresOf(md, codes) {
  const tasks = splitTasks(md)
  const set = new Set()
  for (const code of codes) {
    const chunk = tasks.get(code)
    if (!chunk) continue
    const meta = taskMeta(chunk)
    for (const k of ['рисунок', 'рисунок-условие']) {
      if (meta[k] && meta[k] !== 'нет') set.add(meta[k])
    }
  }
  return [...set]
}
