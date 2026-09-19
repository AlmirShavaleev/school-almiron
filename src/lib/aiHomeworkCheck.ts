/**
 * Черновик ИИ-проверки ДЗ — типы и чистые помощники.
 *
 * Главное, что здесь стоит держать в голове: это ПРЕДЛОЖЕНИЕ. Ни балл, ни
 * текст, ни рамки не видны ученику, пока преподаватель их не принял. Вердикт
 * по-прежнему ставит человек через topic_homework_review_attempt, а ИИ пишет
 * в свои таблицы (миграция 20260730225053).
 */

export type AiJobStatus = 'pending' | 'processing' | 'done' | 'failed'
export type AiConfidence = 'high' | 'medium' | 'low'
export type AiFindingCategory = 'comment' | 'calc' | 'logic' | 'format' | 'praise'

export type AiTaskVerdict = 'correct' | 'wrong' | 'partial' | 'unchecked'

/** Строка таблицы заданий v17 (§180) — зеркало `TaskRow` из `check-homework-ai/findings.ts`. */
export interface AiTaskRow {
  no: string
  verdict: AiTaskVerdict
  student_answer: string
  expected_answer: string
  note: string
}

export interface AiJobRow {
  id: string
  attempt_id: string
  status: AiJobStatus
  provider: string | null
  model: string | null
  readable: boolean | null
  suggested_score: number | null
  confidence: AiConfidence | null
  summary: string | null
  last_error: string | null
  /**
   * Был ли у проверки авторский эталон (§135): used — подставлен, missing — у
   * темы нет решения, failed — разбор PDF не удался. null — проверка старее
   * §135, тогда эталона не было гарантированно: условие `kind = 'text'`
   * отсекало все 844 PDF.
   */
  reference_state: 'used' | 'missing' | 'failed' | null
  reference_chars: number | null
  /** Дошло ли условие ДЗ — рабочий лист (§149.1). null — проверка старее §149.1. */
  worksheet_state: 'used' | 'missing' | 'failed' | null
  worksheet_chars: number | null
  /**
   * §180 (v17). Таблица по заданиям, из которой код считает балл:
   * `[{no, verdict, student_answer, expected_answer, note}]`. Показывает её
   * панель (§186, `aiTasksOf`); undefined/null — проверка старее v17, таких
   * в базе три десятка, и блок «По заданиям» им не рисуется вовсе.
   */
  tasks?: AiTaskRow[] | null
  /** §180. Сколько находок модели отбросил код (выдумки, лимиты, рамки). */
  dropped_findings?: number | null
  accepted_at: string | null
  created_at: string
  completed_at: string | null
}

export interface AiFindingRow {
  id: string
  job_id: string
  file_id: string
  page: number
  rect_x: number
  rect_y: number
  rect_w: number
  rect_h: number
  category: AiFindingCategory
  text: string
  position: number
  /**
   * §192. Номер задания, названный самой функцией: тот `task`, по которому
   * фильтр находок держит лимит «одна находка на задание» (`findings.ts`).
   * null/undefined — проверка старее §192 (столбца не было) либо модель номера
   * не назвала; тогда связь со строкой таблицы ищется в тексте.
   */
  task?: string | null
}

/**
 * Подпись про эталон для панели преподавателя.
 *
 * Молчать нельзя: проверка без авторского решения — другой уровень доверия,
 * модель там сверяла работу со своим собственным решением. `null` — показывать
 * нечего (проверка ещё идёт или она старее §135).
 */
export function referenceNotice(job: AiJobRow): string | null {
  if (job.status !== 'done') return null
  if (job.reference_state === 'used') return null
  if (job.reference_state === 'failed') return 'Проверено без эталона: решение не удалось прочитать'
  if (job.reference_state === 'missing') return 'Проверено без эталона: у темы нет авторского решения'
  return null
}

/**
 * Подпись про условие ДЗ (§149.1) — по тому же принципу, что и про эталон:
 * без рабочего листа модель восстанавливала состав заданий по решению.
 */
export function worksheetNotice(job: AiJobRow): string | null {
  if (job.status !== 'done') return null
  if (job.worksheet_state === 'used') return null
  if (job.worksheet_state === 'failed') return 'Проверено без условия: рабочий лист не удалось прочитать'
  if (job.worksheet_state === 'missing') return 'Проверено без условия: у темы нет рабочего листа ДЗ'
  return null
}

/**
 * Категория находки словами. Те же слова, что у человека в аннотаторе
 * (`SubmissionReviewer.CATEGORIES`): рамка ИИ и рамка преподавателя попадают
 * в один разбор, и называться по-разному они не могут. Копия здесь потому,
 * что в аннотаторе список не экспортирован, а сам он — чужая зона (§184).
 */
export const FINDING_CATEGORY_LABEL: Record<AiFindingCategory, string> = {
  comment: 'Комментарий',
  calc: 'Вычислительная ошибка',
  logic: 'Логическая ошибка',
  format: 'Оформление',
  praise: 'Отлично',
}

/** Насколько модель уверена — словами, а не ярлыком. */
export const CONFIDENCE_LABEL: Record<AiConfidence, string> = {
  high: 'высокая уверенность',
  medium: 'средняя уверенность',
  low: 'низкая уверенность',
}

/**
 * Стоит ли вообще показывать предложенный балл.
 *
 * При низкой уверенности или нечитаемой работе число рядом с надписью
 * «предлагает ИИ» слишком легко принять за оценку. Лучше показать разбор без
 * балла: тогда преподаватель поставит его сам, а не согласится с чужим.
 */
export function shouldShowScore(job: AiJobRow): boolean {
  return job.status === 'done'
    && job.readable !== false
    && job.suggested_score != null
    && job.confidence !== 'low'
}

// ---------------------------------------------------------------------------
// Проверена не вся работа (§189)
// ---------------------------------------------------------------------------

/**
 * Абзацы разбора, которые объясняют неполную проверку. Оба пишет функция:
 * «Проверено не всё:» — про страницы, не доехавшие до модели,
 * «Не сверены задания» — про строки таблицы с вердиктом unchecked.
 */
const PARTIAL_REASON_HEADS = ['Проверено не всё:', 'Не сверены задания']

/** Пояснение к плашке «Проверена не вся работа» — из summary, дословно. */
export function partialCheckReason(summary: string | null | undefined): string | null {
  const picked = String(summary ?? '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => PARTIAL_REASON_HEADS.some(head => part.startsWith(head)))
  return picked.length > 0 ? picked.join('\n\n') : null
}

/**
 * Балла нет, хотя разбор состоялся, — потому что прочитана не вся работа.
 *
 * Функция гасит `suggested_score`, когда страницы не влезли или несверенных
 * заданий набралось от пятой части (§189). Панель обязана назвать причину:
 * иначе пустое место на месте балла читается как «ИИ не справился», и
 * преподаватель поставит балл сам, не заметив, что часть работы ИИ не видел.
 * Разбор при этом полноценный, и таблица по заданиям на месте — потому
 * условие требует её наличия.
 */
export function isPartialCheck(job: AiJobRow | null | undefined): boolean {
  return job != null
    && job.status === 'done'
    && job.readable !== false
    && job.suggested_score == null
    && aiTasksOf(job) != null
}

// ---------------------------------------------------------------------------
// Таблица по заданиям (§186)
// ---------------------------------------------------------------------------

/** Вердикт строки словами — то же, что показывает панель рядом со значком. */
export const TASK_VERDICT_LABEL: Record<AiTaskVerdict, string> = {
  correct: 'верно',
  wrong: 'неверно',
  partial: 'частично',
  unchecked: 'не сверено',
}

const TASK_VERDICTS: readonly string[] = ['correct', 'wrong', 'partial', 'unchecked']

/**
 * Таблица заданий проверки — или `null`, когда показывать нечего.
 *
 * `null` здесь значит «блока в панели не будет»: у трёх десятков проверок
 * старее v17 столбец пустой, и панель обязана выглядеть ровно как до §186.
 * Строки приходят из jsonb, то есть из ответа модели через `parseTasks`, —
 * значения перепроверяем ещё раз: кривая строка не должна ронять разбор
 * работы, из-за которого преподаватель сюда и пришёл.
 */
export function aiTasksOf(job: AiJobRow | null | undefined): AiTaskRow[] | null {
  if (!job || job.status !== 'done' || !Array.isArray(job.tasks)) return null
  const rows: AiTaskRow[] = []
  for (const item of job.tasks) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<AiTaskRow>
    const no = String(raw.no ?? '').trim()
    if (!no) continue
    rows.push({
      no,
      // Неизвестный вердикт — «не сверено», как в findings.ts: в сомнении
      // задание не идёт ни в плюс, ни в минус.
      verdict: TASK_VERDICTS.includes(raw.verdict as string) ? raw.verdict as AiTaskVerdict : 'unchecked',
      student_answer: String(raw.student_answer ?? '').trim(),
      expected_answer: String(raw.expected_answer ?? '').trim(),
      note: String(raw.note ?? '').trim(),
    })
  }
  return rows.length > 0 ? rows : null
}

export interface AiTasksSummary {
  correct: number
  wrong: number
  partial: number
  unchecked: number
  total: number
}

/**
 * Сводка по таблице — она же объяснение балла.
 *
 * Балл считает функция (§180: `(correct + 0,5·partial) / (всего −
 * unchecked)`), и рядом с ним преподаватель должен видеть числа, из которых
 * он вышел, иначе балл снова выглядит мнением модели.
 */
export function summarizeTasks(tasks: readonly AiTaskRow[]): AiTasksSummary {
  const summary: AiTasksSummary = { correct: 0, wrong: 0, partial: 0, unchecked: 0, total: tasks.length }
  for (const t of tasks) summary[t.verdict] += 1
  return summary
}

/** Номер задания к сравнению: «№ 4», «4.», «4 » — одно и то же задание. */
export function normalizeTaskNo(raw: string | null | undefined): string {
  return String(raw ?? '').toLowerCase().replace(/[\s№.]/g, '')
}

/**
 * Номер задания из текста находки: «В задаче 4 …», «задание 12», «№ 7».
 *
 * Копия `taskNoFromText` из `check-homework-ai/findings.ts`. С §192 это
 * запасной путь, а не основной: номер задания приходит из базы столбцом
 * `task`. Правило остаётся ради проверок, сделанных до §192, — их в базе
 * уже несколько десятков, и связь у них восстанавливается только так.
 */
export function taskNoFromText(text: string | null | undefined): string {
  const m = String(text ?? '').match(/(?:задач[аеиу]|задани[еяию]|№)\s*№?\s*(\d{1,3}[а-яa-z]?)/iu)
  return m ? m[1] : ''
}

/**
 * Номер задания находки, приведённый к сравнению (§192).
 *
 * Единственное место, где решается, к какому заданию относится находка.
 * Сначала столбец `task` — его пишет сама функция из своей же таблицы, и это
 * данные, а не догадка; и только если он пуст (проверки до §192 либо модель
 * номера не назвала) — старое правило по тексту. Пусто — находка ничьей
 * строке не принадлежит, и подсвечивать её нечем.
 */
export function taskNoOfFinding(finding: Pick<AiFindingRow, 'text'> & { task?: string | null }): string {
  const fromColumn = normalizeTaskNo(finding.task)
  return fromColumn || normalizeTaskNo(taskNoFromText(finding.text))
}

/** Находки, относящиеся к строке таблицы. Пусто — строке подсвечивать нечего. */
export function findingsOfTask(findings: readonly AiFindingRow[], no: string): AiFindingRow[] {
  const target = normalizeTaskNo(no)
  if (!target) return []
  return findings.filter(f => taskNoOfFinding(f) === target)
}

/** Идёт ли прогон прямо сейчас — для блокировки кнопки и спиннера. */
export function isRunning(job: AiJobRow | null): boolean {
  return job != null && (job.status === 'pending' || job.status === 'processing')
}

/**
 * Превращает находки в рамки для аннотатора.
 *
 * Находка ссылается на файл по id, а аннотатор адресует страницы по
 * storage_path — отсюда карта. Находки на файлы, которых в разборе нет
 * (например, файл удалили после проверки), выбрасываются: рамку некуда класть.
 */
export function findingsToRegions(
  findings: AiFindingRow[],
  filePathById: Record<string, string>,
): Array<{
  filePath: string
  page: number
  rect: { x: number; y: number; w: number; h: number }
  category: AiFindingCategory
  text: string
  sourceId: string
  jobId: string | null
}> {
  const out = []
  for (const f of findings) {
    const filePath = filePathById[f.file_id]
    if (!filePath) continue
    out.push({
      filePath,
      page: f.page,
      rect: { x: f.rect_x, y: f.rect_y, w: f.rect_w, h: f.rect_h },
      category: f.category,
      text: f.text,
      // §207. Пометка источника едет вместе с рамкой: по ней повторный перенос
      // узнаёт свои прежние рамки и заменяет их, а не кладёт вторым слоем.
      sourceId: f.id,
      jobId: f.job_id ?? null,
    })
  }
  return out
}

/**
 * Человеческое объяснение отказа.
 *
 * Технические тексты («503», «GEMINI_API_KEY») преподавателю ничего не
 * говорят, а вот «не настроено» — говорит, и он поймёт, к кому идти.
 */
export function aiErrorMessage(raw: string | null | undefined): string {
  const text = String(raw ?? '').trim()
  if (!text) return 'ИИ-проверка не удалась'
  if (text.includes('AI_API_KEY') || text.includes('GEMINI_API_KEY') || text.includes('не настроена')) {
    return 'ИИ-проверка ещё не подключена — нужен ключ модели в настройках проекта'
  }
  if (text.includes('нет файлов') || text.includes('нет фотографий') || text.includes('слишком большие')) return text
  if (/\b(429|quota|RESOURCE_EXHAUSTED)\b/i.test(text)) {
    return 'Лимит запросов к модели исчерпан — попробуйте позже'
  }
  if (/\b(401|403|API key)\b/i.test(text)) {
    return 'Ключ модели отклонён — проверьте настройки проекта'
  }
  return text.length > 300 ? text.slice(0, 300) + '…' : text
}
