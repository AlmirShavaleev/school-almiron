/**
 * §248. Спокойный экран проверки: учитель смотрит на фото и ОДНО текущее
 * задание, всё остальное — по запросу. Здесь — чистые правила этого экрана,
 * без React: какого цвета клетка в полосе номеров, где стоит синяя точка
 * подсказки ИИ, что значат клавиши 1/2/3 и ←/→ и когда они молчат.
 *
 * Данные те же, что у таблицы проверки (§199/§238): строки
 * `topic_homework_review_tasks` — результат, слепок ИИ (`ai_jobs.tasks`) —
 * только подсказка. ИИ здесь ничего не пишет: вердикт ставит человек.
 */
import { taskNoOfFinding, type AiFindingRow, type AiTaskRow } from './aiHomeworkCheck'
import type { ReviewTaskRow, ReviewTaskVerdict } from './homeworkReviewTasks'
import { noteTaskKey } from './reviewNotes'
import { classifyRow, type RowTriage } from './reviewTriage'

/**
 * Три основных вердикта и их клавиши — порядок макета: «Верно · Частично ·
 * Неверно». Это НЕ раскладка таблицы §209 (там 2 — «неверно»): на этом
 * экране кнопки стоят в порядке макета, и цифра обязана совпадать с
 * местом кнопки, иначе клавиша читается подписью, а не рукой.
 * «Не сверено» и «Не решено» клавиш не получают (задача §248).
 */
export const FOCUS_VERDICTS = ['correct', 'partial', 'wrong'] as const
export type FocusVerdict = typeof FOCUS_VERDICTS[number]

export const FOCUS_VERDICT_KEYS: Readonly<Record<string, FocusVerdict>> = {
  '1': 'correct',
  '2': 'partial',
  '3': 'wrong',
}

export const FOCUS_VERDICT_LABEL: Readonly<Record<FocusVerdict, string>> = {
  correct: 'Верно',
  partial: 'Частично',
  wrong: 'Неверно',
}

/** Клетка полосы номеров: цвет — вердикт, всё непроверенное — нейтрально. */
export type StripTone = 'ok' | 'part' | 'bad' | 'neutral'

export function stripTone(verdict: ReviewTaskVerdict): StripTone {
  if (verdict === 'correct') return 'ok'
  if (verdict === 'partial') return 'part'
  if (verdict === 'wrong') return 'bad'
  return 'neutral'
}

/** «X верно · Y частично · Z неверно» под полосой. */
export function focusCounts(rows: readonly { verdict: ReviewTaskVerdict }[]): Record<FocusVerdict, number> {
  const out: Record<FocusVerdict, number> = { correct: 0, partial: 0, wrong: 0 }
  for (const row of rows) {
    if (row.verdict === 'correct' || row.verdict === 'partial' || row.verdict === 'wrong') out[row.verdict] += 1
  }
  return out
}

/**
 * Что ИИ говорит про задание. `note` — заметка модели из слепка проверки
 * (не поле `note` таблицы: то видит ученик, §238), `suggestions` — сколько
 * находок ИИ по этому заданию ещё ждут «взять/мимо», `triage` — светофор
 * §238 (почему задание стоит посмотреть).
 */
export interface TaskAiHint {
  note: string
  suggestions: number
  triage: RowTriage | null
  /** Есть ли это задание в таблице ИИ вообще. */
  known: boolean
}

/**
 * Подсказки ИИ по строкам таблицы. Ключ — id строки. Слепок ищется по
 * номеру в том же ключе, что у рамок (`noteTaskKey`): «№ 4» и «4» — одно.
 */
export function aiHintsByRow(
  rows: readonly ReviewTaskRow[],
  aiTasks: readonly AiTaskRow[] | null | undefined,
  pendingFindings: readonly AiFindingRow[],
): Map<string, TaskAiHint> {
  const byNo = new Map<string, AiTaskRow>()
  for (const task of aiTasks ?? []) {
    const key = noteTaskKey(task.no)
    if (key && !byNo.has(key)) byNo.set(key, task)
  }
  const suggestions = new Map<string, number>()
  for (const finding of pendingFindings) {
    const key = noteTaskKey(taskNoOfFinding(finding))
    if (key) suggestions.set(key, (suggestions.get(key) ?? 0) + 1)
  }
  const out = new Map<string, TaskAiHint>()
  for (const row of rows) {
    const key = noteTaskKey(row.no)
    const ai = byNo.get(key)
    const note = String(ai?.note ?? '').trim()
    out.set(row.id, {
      note,
      suggestions: suggestions.get(key) ?? 0,
      triage: ai || aiTasks
        ? classifyRow({
            aiVerdict: ai?.verdict ?? null,
            studentAnswer: row.student_answer,
            expectedAnswer: row.expected_answer,
            note,
          })
        : null,
      known: ai != null,
    })
  }
  return out
}

/**
 * Синяя точка на номере: у ИИ есть что сказать про задание — заметка или
 * неразобранная находка. Светофор сам по себе точку не ставит: «ИИ: верно,
 * ответ совпал» подсказкой не является, а жёлтые без заметки и так видны
 * цветом вердикта.
 */
export function hasAiHint(hint: TaskAiHint | undefined | null): boolean {
  return Boolean(hint && (hint.note.length > 0 || hint.suggestions > 0))
}

/**
 * Строка «ИИ: …» у текущего задания. Заметка модели, а если её нет — причина
 * светофора, которую человек иначе не увидит: «частично» при совпавшем
 * ответе §238 кладёт в таблицу как «верно», и без этой строки сомнение ИИ
 * пропало бы с экрана совсем. `null` — сказать нечего.
 */
export function aiLineText(hint: TaskAiHint | undefined | null): string | null {
  if (!hint) return null
  if (hint.note) return hint.note
  const reason = hint.triage?.reason
  if (reason === 'partial_equal') return '«частично», но ответ совпал с эталоном'
  if (reason === 'correct_other_form') return '«верно», но ответ записан иначе — код не смог сверить его с эталоном'
  if (reason === 'unchecked' && hint.known) return 'не сверено'
  return null
}

/** Индекс на шаг вперёд/назад, без выхода за края. */
export function stepIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const from = index < 0 ? 0 : index
  return Math.max(0, Math.min(length - 1, from + delta))
}

/**
 * Клавиша в поле ввода — это буква, а не команда экрана. Туда же — `select`,
 * `contenteditable` и всё, что само объявило, что клавиши экрана внутри него
 * не действуют (`data-review-keys="off"`: полная таблица заданий со своей
 * раскладкой §209, диалог «Очистить пометки»).
 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el !== 'object') return false
  const tag = String(el.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return Boolean(el.closest?.('[data-review-keys="off"]'))
}
