/**
 * §238. Недельная точность ИИ-проверки: строки RPC `ai_check_accuracy`
 * (вердикт ИИ × ответ совпал) → шесть строк таблицы, как в выгрузке, по
 * которой строился светофор. «Неверно» и «не сверено» по совпадению ответа не
 * делятся: у них это знание ничего не меняет в светофоре.
 */

export interface AiAccuracyRow {
  ai_verdict: string
  answer_match: boolean
  tasks: number
  changed: number
  works: number
}

export interface AiAccuracyLine {
  key: 'correct_equal' | 'correct_other' | 'partial_equal' | 'partial_other' | 'wrong' | 'unchecked'
  label: string
  tasks: number
  changed: number
  /** Доля изменённых, 0..100, целое; null — заданий нет. */
  share: number | null
  /** Зелёная ли это строка светофора. */
  green: boolean
}

const LINES: Array<Omit<AiAccuracyLine, 'tasks' | 'changed' | 'share'> & { match: (r: AiAccuracyRow) => boolean }> = [
  { key: 'correct_equal', label: 'верно, ответ совпал', green: true, match: r => r.ai_verdict === 'correct' && r.answer_match },
  { key: 'correct_other', label: 'верно, ответ записан иначе', green: false, match: r => r.ai_verdict === 'correct' && !r.answer_match },
  { key: 'partial_equal', label: 'частично, ответ совпал', green: false, match: r => r.ai_verdict === 'partial' && r.answer_match },
  { key: 'partial_other', label: 'частично, ответ другой', green: false, match: r => r.ai_verdict === 'partial' && !r.answer_match },
  { key: 'wrong', label: 'неверно', green: false, match: r => r.ai_verdict === 'wrong' },
  { key: 'unchecked', label: 'не сверено', green: false, match: r => r.ai_verdict !== 'correct' && r.ai_verdict !== 'partial' && r.ai_verdict !== 'wrong' },
]

/** Строка, как её отдаёт PostgREST: `bigint` бывает строкой. */
export type AiAccuracyWireRow = {
  ai_verdict?: string | null
  answer_match?: boolean | null
  tasks?: number | string | null
  changed?: number | string | null
  works?: number | string | null
}

/** Строки RPC → строки таблицы. Числа приводим: `bigint` приходит и строкой. */
export function accuracyLines(rows: readonly AiAccuracyWireRow[] | null | undefined): AiAccuracyLine[] {
  const clean: AiAccuracyRow[] = (rows ?? []).map(r => ({
    ai_verdict: String(r.ai_verdict ?? ''),
    answer_match: r.answer_match === true,
    tasks: Number(r.tasks) || 0,
    changed: Number(r.changed) || 0,
    works: Number(r.works) || 0,
  }))
  return LINES.map(({ match, ...line }) => {
    const mine = clean.filter(match)
    const tasks = mine.reduce((sum, r) => sum + r.tasks, 0)
    const changed = mine.reduce((sum, r) => sum + r.changed, 0)
    return { ...line, tasks, changed, share: tasks > 0 ? Math.round((changed / tasks) * 100) : null }
  })
}

/** Итог: всего заданий, доля зелёных, правок в зелёных. */
export function accuracyTotals(lines: readonly AiAccuracyLine[]) {
  const tasks = lines.reduce((sum, l) => sum + l.tasks, 0)
  const green = lines.find(l => l.green)
  return {
    tasks,
    greenShare: tasks > 0 && green ? Math.round((green.tasks / tasks) * 100) : null,
    greenChanged: green?.changed ?? 0,
  }
}

/**
 * Отказ RPC словами. Функции ещё нет (PENDING_238 не применён) — не ошибка,
 * а состояние: так и говорим.
 */
export function accuracyErrorText(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null
  const msg = String(error.message ?? '')
  if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function|does not exist/i.test(msg)) {
    return 'Отчёт появится после применения миграции §238.'
  }
  if (error.code === '42501') return 'Отчёт виден только администратору школы.'
  return msg || 'Не удалось посчитать точность ИИ-проверки'
}
