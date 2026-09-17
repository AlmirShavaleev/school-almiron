/**
 * Задачи с развёрнутым ответом (часть 2) — единственное место, где решается,
 * что показывать вместо ответа.
 *
 * Зачем это вообще: у задач части 2 отдельного ответа нет по природе — ответ
 * живёт внутри решения, а проверяющий сверяется с критериями оценивания и
 * максимальным баллом. Импорт каталога ничего не потерял: у №13 ЕГЭ по
 * математике 505 задач из 514 — часть 2 (`has_answer = false`), и почти у всех
 * из них заполнены `grade_criteria_html` и `max_points`. Раньше в печати на их
 * месте стояло «Ответ не указан» — неправда, из-за которой подборка выглядела
 * недогруженной.
 *
 * Чего здесь намеренно НЕТ: попытки вытащить ответ из хвоста решения
 * регулярками. У части 2 «ответ» бывает интервалом, системой, перечнем
 * случаев — вытащенное врало бы ровно в тех задачах, которые никто не станет
 * перепроверять. Показываем только то, что в базе действительно есть.
 *
 * Признак берём не по `exam_part`, а по паре «ответа нет + критерии есть»:
 * часть экзамена размечена не везде (в каталоге для этого даже висит плашка
 * «часть не размечена») и подтягивается не всеми запросами, а критерии — это
 * ровно то содержимое, которое мы собираемся показать. Так подпись не может
 * появиться там, где показывать нечего.
 */
import { plural } from '@/lib/plural'

export interface ExtendedAnswerTask {
  has_answer?: boolean | null
  grade_criteria_html?: string | null
  max_points?: number | null
}

/** Задача с развёрнутым ответом: собственного ответа нет, но есть критерии. */
export function hasExtendedAnswer(task: ExtendedAnswerTask | null | undefined): boolean {
  if (!task) return false
  if (task.has_answer) return false
  return Boolean(task.grade_criteria_html && task.grade_criteria_html.trim())
}

/**
 * `max_points`, если он годится для показа. В каталоге колонка необязательная
 * и не во всех запросах выбирается — молча подставлять «1 балл» нельзя, это
 * было бы такой же выдумкой, как вытащенный регуляркой ответ.
 */
function usableMaxPoints(maxPoints: number | null | undefined): number | null {
  if (typeof maxPoints !== 'number' || !Number.isFinite(maxPoints) || maxPoints <= 0) return null
  return maxPoints
}

/** «3 балла», «5 баллов» — число с правильной формой слова. */
export function formatPoints(maxPoints: number): string {
  return `${maxPoints} ${plural(maxPoints, 'балл', 'балла', 'баллов')}`
}

/** Печать, вместо «Ответ не указан»: «Развёрнутый ответ. Максимум 3 балла». */
export function extendedAnswerLabel(maxPoints: number | null | undefined): string {
  const points = usableMaxPoints(maxPoints)
  return points === null
    ? 'Развёрнутый ответ'
    : `Развёрнутый ответ. Максимум ${formatPoints(points)}`
}

/** Сводная таблица ответов — клетка узкая: «разв., 3 б.». */
export function extendedAnswerShort(maxPoints: number | null | undefined): string {
  const points = usableMaxPoints(maxPoints)
  return points === null ? 'разв.' : `разв., ${points} б.`
}

/** Каталог, подпись рядом с кнопками: одна строка, не блок. */
export function extendedAnswerNote(maxPoints: number | null | undefined): string {
  const points = usableMaxPoints(maxPoints)
  return points === null
    ? 'Ответ развёрнутый — см. критерии'
    : `Ответ развёрнутый — см. критерии, максимум ${formatPoints(points)}`
}
