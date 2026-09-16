/**
 * Таблица по заданиям, балл и фильтр находок ИИ-проверки (v17, §180; v18, §189).
 *
 * Чистый модуль без Deno-API и без сети — как `reference.ts`: его гоняет
 * vitest из `src/`, потому что `index.ts` живёт в Deno и в песочнице не
 * запускается. Сеть и база — в `index.ts`, здесь только решения, которые
 * обязаны быть проверены тестом.
 *
 * Зачем это всё (выгрузка 30 прогонов v16, `board/033`):
 *  — балл модель ставила свободным числом и он не следовал из её же разбора
 *    («ошибка в одной задаче из шести» → 5 из 5). Теперь модель отдаёт ТАБЛИЦУ
 *    по заданиям, а балл считает код;
 *  — находки-выдумки с самопротиворечием («должно быть 0,78, а не 0,78»,
 *    «−8 вместо −8») — модель отмечает ошибку там, где значения равны, чтобы
 *    было что написать. Такая находка отнимает у преподавателя доверие ко
 *    всем остальным. Фильтр: по таблице (ответ ученика = ожидаемый) и по
 *    тексту (шаблоны «X, а не X»);
 *  — похвала — 39 % находок, потолок MAX_FINDINGS съедали praise, а ошибки в
 *    него не влезали. Лимиты по категориям считаются здесь, а не в промпте:
 *    промпт модель не выполняет, код — выполняет.
 *
 * v18 (§189), первая живая проверка v17 на проде:
 *  — вердикт спорил с собственными ответами модели: строка «12 / 30, ответ
 *    неверен: должно быть 30» стояла с вердиктом `correct`, и балл выходил 97
 *    вместо 84. Фильтр §180 ловил только ОБРАТНЫЙ случай (`wrong` при равных
 *    ответах). Теперь сверка идёт в обе стороны — и по ЧИСЛАМ, а не по
 *    строкам: «в 144 раза» и «144» — одно и то же, «12» и «30» — разное;
 *  — работа читалась не целиком (8 страниц из 11), а балл выглядел
 *    полноценным. Балл по двум третям работы для преподавателя хуже, чем
 *    отсутствие балла: он поставит его не глядя. Отсюда `isPartialCheck`.
 */

export const CATEGORIES = ['comment', 'calc', 'logic', 'format', 'praise'] as const
export type Category = typeof CATEGORIES[number]

export const TASK_VERDICTS = ['correct', 'wrong', 'partial', 'unchecked'] as const
export type TaskVerdict = typeof TASK_VERDICTS[number]

/** Строка таблицы заданий — то, что модель отдаёт в `tasks` и что ложится в `topic_homework_ai_jobs.tasks`. */
export interface TaskRow {
  no: string
  verdict: TaskVerdict
  student_answer: string
  expected_answer: string
  note: string
}

/** Находка после разбора JSON, ещё без проверки рамки (рамку проверяет `index.ts`). */
export interface FindingDraft {
  category: Category
  text: string
  /** Номер задания из таблицы; пусто — модель не указала. */
  task: string
}

/** Потолок находок на работу; с v17 — страховка, а не рабочий предел. */
export const MAX_FINDINGS = 12
/** Замечаний по оформлению на работу. */
export const MAX_FORMAT_FINDINGS = 2
/** Похвалы на работу — и только когда есть хотя бы одна ошибка. */
export const MAX_PRAISE_FINDINGS = 1
/**
 * Доля несверенных заданий, с которой проверка считается неполной: уверенность
 * режется до `low`, а балл не выводится вовсе (§189).
 *
 * До v18 порог был 0,3 и влиял только на уверенность. Живой прогон показал,
 * чем это кончается: пять заданий из 21 «отсутствуют» (на деле — не дошли
 * страницы), а в панели «балл 97, уверенность высокая». Преподаватель такой
 * балл принимает не глядя. Порог опущен до 0,2 и теперь гасит балл: пятая
 * часть работы, оставшаяся непрочитанной, — уже не погрешность.
 */
export const UNCHECKED_LOW_CONFIDENCE_SHARE = 0.2

const MAX_TASK_NO_CHARS = 16
const MAX_ANSWER_CHARS = 200
const MAX_NOTE_CHARS = 500

// ---------------------------------------------------------------------------
// Нормализация ответов
// ---------------------------------------------------------------------------

/**
 * Нормализация ответа «как `normalize_variant_answer`» в базе (§63): запятая →
 * точка, пробелы, регистр — плюс то, что нужно для сравнения строк модели, а
 * не ученика: юникодные минусы и тире → «-», лишний «+» в начале, конечная
 * пунктуация, а число приводится к канонической записи («0.20» = «0.2»,
 * «-0» = «0»). Пробелы убираются целиком, а не схлопываются: у модели
 * «3 из 15» и «3из15» — одно и то же значение.
 */
export function normalizeAnswer(raw: unknown): string {
  let s = String(raw ?? '')
    .toLowerCase()
    .replace(/[\u2212\u2013\u2014\u2012]/g, '-')
    .replace(/[\u00a0\s]+/g, '')
    .replace(/,/g, '.')
    .replace(/[.;:!?]+$/g, '')
    .replace(/^\+/, '')
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) s = String(n)
  }
  return s
}

/** Равны ли два ответа по смыслу; пустые не считаются равными ничему. */
export function answersEqual(a: unknown, b: unknown): boolean {
  const x = normalizeAnswer(a)
  const y = normalizeAnswer(b)
  return x.length > 0 && y.length > 0 && x === y
}

// ---------------------------------------------------------------------------
// Сверка ответов числами (§189)
// ---------------------------------------------------------------------------

/**
 * Слова-обёртки, которые не меняют значения числа: «в 144 раза» — это 144.
 * Список короткий намеренно: всё, чего здесь нет, считается ЕДИНИЦЕЙ и
 * сравнивается (см. `compareAnswers`).
 */
const FILLER_WORDS = new Set([
  'в', 'во', 'около', 'примерно', 'приблизительно', 'ответ', 'равно', 'равен',
  'раз', 'раза', 'разов', 'ровно', 'всего', 'итого', 'и', 'это',
])

/** «±8» — это множество {−8, 8}, а не число: сравнивать нечего. */
const AMBIGUOUS_SIGN = /[±∓]/

/** Число и единица из ответа; null — числа нет или их несколько. */
export interface AnswerNumber {
  value: number
  /** Что осталось от строки, кроме числа и слов-обёрток: «куб см», «%», ''. */
  unit: string
}

/**
 * Число из ответа — или `null`, если вытащить его однозначно нельзя.
 *
 * Правило одно: ровно ОДНО числовое значение в строке. «2 30/49» (смешанная
 * дробь), «3 из 15», «А-2, Б-3», «0,82 - 0,04» дают несколько чисел — значит
 * сравнивать нечего, и вердикт модели останется как есть. Это дороже по
 * пропущенным случаям, но дешевле по испорченным: гадать на ответе ученика
 * нельзя (§189).
 */
export function answerNumber(raw: unknown): AnswerNumber | null {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[−–—‒]/g, '-')
    .replace(/\u00a0/g, ' ')
    // Пробел-разделитель разрядов — только перед ГРУППОЙ ИЗ ТРЁХ цифр:
    // «1 000 000» — одно число, «2 30/49» — три.
    .replace(/(\d)\s+(?=\d{3}(?:\D|$))/g, '$1')
    // Десятичная запятая; «А-2, Б-3» не трогаем — там после запятой пробел.
    .replace(/(\d),(?=\d)/g, '$1.')
    .trim()
  if (!s || AMBIGUOUS_SIGN.test(s)) return null

  const numbers = s.match(/-?\d+(?:\.\d+)?/g)
  if (!numbers || numbers.length !== 1) return null
  const value = Number(numbers[0])
  if (!Number.isFinite(value)) return null

  const unit = s
    .replace(numbers[0], ' ')
    .replace(/[.,;:!?()[\]«»"'’]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 0 && !FILLER_WORDS.has(word))
    .join(' ')
  return { value, unit }
}

export type AnswerMatch = 'equal' | 'different' | 'unknown'

/**
 * Сверка ответа ученика с ожидаемым. `unknown` — сравнить нельзя, и это
 * полноправный ответ: по нему вердикт модели не трогают вовсе.
 *
 * Сравниваются ЧИСЛА, а не строки: в живой таблице «в 144 раза» и «144»,
 * «3,6 куб. см» и «3,6» — один и тот же ответ, записанный по-разному. Три
 * случая, где код молчит, потому что рискует ошибиться:
 *  — числа не вытащились (текст, набор, «да/нет», формула, дробь);
 *  — проценты только с одной стороны («50 %» и «0,5» — возможно, одно и то же);
 *  — единицы названы с обеих сторон и разные («0,5 м» и «50 см»): это перевод
 *    единиц, а не ошибка ученика, и решать его на глазок мы не станем.
 */
export function compareAnswers(a: unknown, b: unknown): AnswerMatch {
  if (answersEqual(a, b)) return 'equal'
  const x = answerNumber(a)
  const y = answerNumber(b)
  if (!x || !y) return 'unknown'
  if (x.unit.includes('%') !== y.unit.includes('%')) return 'unknown'
  if (x.unit && y.unit && x.unit !== y.unit) return 'unknown'
  return x.value === y.value ? 'equal' : 'different'
}

// ---------------------------------------------------------------------------
// Таблица заданий
// ---------------------------------------------------------------------------

function str(value: unknown, limit: number): string {
  if (value == null) return ''
  return String(typeof value === 'object' ? JSON.stringify(value) : value).trim().slice(0, limit)
}

/**
 * Таблица заданий из сырого ответа модели. Кривые строки выбрасываются
 * поштучно; неизвестный вердикт — `unchecked` (не за и не против), а не
 * `wrong`: в сомнении — в пользу ученика. Дубли номеров схлопываются, первая
 * строка побеждает.
 */
export function parseTasks(raw: unknown): TaskRow[] {
  if (!Array.isArray(raw)) return []
  const out: TaskRow[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const no = str(r.no ?? r.task ?? r.number, MAX_TASK_NO_CHARS)
    if (!no) continue
    const key = no.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const verdictRaw = String(r.verdict ?? '').trim().toLowerCase()
    const verdict: TaskVerdict = (TASK_VERDICTS as readonly string[]).includes(verdictRaw)
      ? verdictRaw as TaskVerdict
      : 'unchecked'
    out.push({
      no,
      verdict,
      student_answer: str(r.student_answer, MAX_ANSWER_CHARS),
      expected_answer: str(r.expected_answer, MAX_ANSWER_CHARS),
      note: str(r.note, MAX_NOTE_CHARS),
    })
  }
  return out
}

/**
 * Заметка говорит, что ход решения был верным, а сбой — в конце. Тогда
 * понижение идёт до `partial`, а не до `wrong`: §149 велит в спорном решать
 * в пользу ученика, и «верный ход с арифметической ошибкой» — ровно половина
 * задания, а не ноль.
 */
const CORRECT_PATH_NOTE = new RegExp(
  '(?:верн[а-яё]*\\s+ход|ход\\s+верн[а-яё]*|верно\\s+(?:реш|найден|рассужд|записан)[а-яё]*'
  + '|арифметическ[а-яё]*|вычислительн[а-яё]*|описк[а-яё]*|округлени[а-яё]*'
  + '|в\\s+конце|при\\s+переносе)',
  'iu',
)

/** До какого вердикта понижать `correct` с несовпавшим ответом. */
export function lowerVerdict(note: string): TaskVerdict {
  return CORRECT_PATH_NOTE.test(String(note ?? '')) ? 'partial' : 'wrong'
}

export interface ReconcileResult {
  tasks: TaskRow[]
  /**
   * Номера заданий, где код ПОНИЗИЛ вердикт `correct` — их называет summary:
   * преподаватель должен видеть, что это правка системы, а не слово модели.
   */
  lowered: string[]
}

/**
 * Таблица, сверенная сама с собой. Две правки, обе — по числам:
 *
 *  — `wrong` при совпавшем ответе → `correct` (§180). Модель отмечает ошибку
 *    там, где значения равны, чтобы было что написать;
 *  — `correct` при РАЗОШЕДШЕМСЯ ответе → `wrong` (или `partial`, если заметка
 *    говорит о верном ходе). Это §189: в живой таблице стояло «12 / 30, ответ
 *    неверен: должно быть 30» с вердиктом `correct`, и балл вышел 97 вместо
 *    84. Модель пишет «неверно» словами и ставит `correct` — фильтр v17 ловил
 *    только обратное направление.
 *
 * Обе правки делаются, только когда `compareAnswers` дал определённый ответ:
 * `unknown` (текст, набор, дробь, разные единицы) оставляет строку модели как
 * есть. Пропустить спорный случай дешевле, чем испортить верный.
 *
 * `partial` с равными ответами НЕ трогаем намеренно: это законный случай
 * §149 «ответ верный, но хода нет / ход с изъяном» там, где условие требует
 * развёрнутого решения. Переводить его в `correct` значило бы отменить
 * правило, добытое на прогонах 10.09.
 */
export function reconcileTasksDetailed(tasks: readonly TaskRow[]): ReconcileResult {
  const lowered: string[] = []
  const out = tasks.map(t => {
    const match = compareAnswers(t.student_answer, t.expected_answer)
    if (t.verdict === 'wrong' && match === 'equal') return { ...t, verdict: 'correct' as const }
    if (t.verdict === 'correct' && match === 'different') {
      lowered.push(t.no)
      return { ...t, verdict: lowerVerdict(t.note) }
    }
    return t
  })
  return { tasks: out, lowered }
}

/** Только строки, без списка понижений — для мест, где список не нужен. */
export function reconcileTasks(tasks: readonly TaskRow[]): TaskRow[] {
  return reconcileTasksDetailed(tasks).tasks
}

// ---------------------------------------------------------------------------
// Балл
// ---------------------------------------------------------------------------

export type GradeScale = 'five' | 'hundred' | null

/**
 * Пятибалльная шкала по доле верных — школьные пороги: 5 от 90 %, 4 от 70 %,
 * 3 от 50 %, ниже — 2. Промпт v16 говорил «доля, округлённая вверх до целого
 * от 2 до 5», и это не определяло ничего: 5/6 верных давало и 5 (0,83·5 =
 * 4,17 → вверх), и 4 (по здравому смыслу). Пороги названы числами, чтобы
 * преподаватель мог их проверить в уме.
 */
export function fiveFromRatio(ratio: number): number {
  if (ratio >= 0.9) return 5
  if (ratio >= 0.7) return 4
  if (ratio >= 0.5) return 3
  return 2
}

export interface ScoreBreakdown {
  correct: number
  partial: number
  wrong: number
  unchecked: number
  /** Заданий в знаменателе: всё, кроме `unchecked`. */
  counted: number
  /** Доля верных с учётом половинок; null — считать не по чему. */
  ratio: number | null
  /** Балл по шкале курса; null — таблицы нет или все задания не сверены. */
  score: number | null
}

/**
 * Балл из таблицы: (correct + 0,5·partial) / (всего − unchecked) → шкала.
 * `unchecked` не считаются ни за, ни против — их перечисляет summary. Пустая
 * таблица даёт null, а не 0: ноль вслепую для преподавателя хуже отсутствия
 * балла (§149).
 */
export function computeScore(tasks: readonly TaskRow[], scale: GradeScale | string | null): ScoreBreakdown {
  let correct = 0, partial = 0, wrong = 0, unchecked = 0
  for (const t of tasks) {
    if (t.verdict === 'correct') correct += 1
    else if (t.verdict === 'partial') partial += 1
    else if (t.verdict === 'wrong') wrong += 1
    else unchecked += 1
  }
  const counted = correct + partial + wrong
  if (counted === 0) return { correct, partial, wrong, unchecked, counted, ratio: null, score: null }
  const ratio = (correct + 0.5 * partial) / counted
  const score = scale === 'five' ? fiveFromRatio(ratio) : Math.round(ratio * 100)
  return { correct, partial, wrong, unchecked, counted, ratio, score }
}

// ---------------------------------------------------------------------------
// Текстовая страховка: «X, а не X»
// ---------------------------------------------------------------------------

// В JS `\w` и `\b` — только ASCII, даже с флагом `u`: кириллицу описываем явно.
const CYR = '[а-яё]'

/** Слова, после которых в фразе стоит ЗНАЧЕНИЕ («должно быть 0,78», «ответ 0,2»). */
const VALUE_TRIGGER = new RegExp(
  `(?:должн[оыаи]\\s+быть|должен\\s+быть|правильн${CYR}*\\s+ответ|неверн${CYR}*\\s+ответ|верн${CYR}*\\s+ответ|ответ|получить|получиться|равн[оаы]|равен|нужно|будет|это)\\s+(?=\\S)`,
  'giu',
)

/**
 * Обрезка ХВОСТА значения: до тире с пробелами (дефис не в счёт — он же минус
 * в «0,82 - 0,04»), скобки, запятой перед словом, служебного слова или конца.
 */
// Без флага `i` намеренно: запятая перед СТРОЧНЫМ словом — граница фразы
// («0,271, хотя ты…»), перед прописной — часть ответа («А-2, Б-3»).
const TAIL_CUT = new RegExp(
  `^(.*?)(?:\\s[—–]\\s|\\s*[()]|,\\s+(?=${CYR})|\\s+(?:но|хотя|что|это|ты|так|тут|здесь|значит|потому|поэтому|а)(?=\\s|$|[,.;:])|$)`,
  'u',
)

function cutValueTail(text: string): string {
  const m = text.match(TAIL_CUT)
  return (m ? m[1] : text).trim()
}

/**
 * Результат выражения: у «0,82 − 0,04 = 0,78» это «0,78». Сравниваем именно
 * результаты: «должно быть 0,78, а не 0,82 − 0,04 = 0,78» — то же
 * самопротиворечие, что и «0,78, а не 0,78».
 */
function resultOf(value: string): string {
  const i = value.lastIndexOf('=')
  return i >= 0 ? value.slice(i + 1) : value
}

/** Значение перед «а не»/«вместо»: от последнего слова-триггера или разделителя. */
function cutValueHead(text: string): string {
  let head = text
  const bySeparator = head.split(/[:—–]\s+/u)
  head = bySeparator[bySeparator.length - 1]
  let lastIndex = -1, lastLength = 0
  VALUE_TRIGGER.lastIndex = 0
  for (let m = VALUE_TRIGGER.exec(head); m; m = VALUE_TRIGGER.exec(head)) {
    lastIndex = m.index
    lastLength = m[0].length
  }
  if (lastIndex >= 0) head = head.slice(lastIndex + lastLength)
  return head.trim()
}

/**
 * Пары «утверждаемое значение / значение ученика» из одной фразы. Шаблоны из
 * выгрузки 15.09: «должно быть X, а не Y», «правильный ответ X, а не Y»,
 * «должно быть X, а у тебя (получилось) Y», «X вместо Y».
 */
export function contradictionPairs(text: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  const clauses = String(text ?? '').split(/[;\n]|[.!?]\s+/u)
  const aNeRe = new RegExp(`^(.*?),?\\s+а\\s+(?:не|у\\s+тебя(?:\\s+получил${CYR}*|\\s+вышло|\\s+записано)?)\\s+(.+)$`, 'iu')
  const vmestoRe = /^(.*?\S)\s+вместо\s+(.+)$/iu
  for (const clause of clauses) {
    const aNe = clause.match(aNeRe)
    if (aNe) {
      pairs.push([cutValueHead(aNe[1]), cutValueTail(aNe[2])])
      continue
    }
    const vmesto = clause.match(vmestoRe)
    if (vmesto) pairs.push([cutValueHead(vmesto[1]), cutValueTail(vmesto[2])])
  }
  return pairs
}

/**
 * Текст утверждает ошибку там, где значения равны: «должно быть 0,78, а не
 * 0,78», «−8 вместо −8», «88, а не 11·8 = 88». Ложные срабатывания редки:
 * обе стороны после нормализации должны совпасть и быть непустыми.
 */
export function isSelfContradictoryText(text: string): boolean {
  return contradictionPairs(text).some(([a, b]) => answersEqual(resultOf(a), resultOf(b)))
}

// ---------------------------------------------------------------------------
// Фильтр находок
// ---------------------------------------------------------------------------

/** Номер задания из текста находки: «В задаче 4 …», «задание 12», «№ 7». */
export function taskNoFromText(text: string): string {
  const m = String(text ?? '').match(/(?:задач[аеиу]|задани[еяию]|№)\s*№?\s*(\d{1,3}[а-яa-z]?)/iu)
  return m ? m[1] : ''
}

export interface FilterResult<T extends FindingDraft = FindingDraft> {
  /** Оставленные находки в порядке вывода; лишние поля (рамка) сохраняются. */
  kept: T[]
  tasks: TaskRow[]
  dropped: number
  /** Причины отброса — в лог функции, по счётчику на причину. */
  droppedBy: Record<'contradiction' | 'text' | 'offTable' | 'limit', number>
  /** §189. Задания, где код понизил вердикт `correct`; их называет summary. */
  lowered: string[]
}

/**
 * Фильтр находок по таблице заданий. Порядок важен:
 *  1. таблица сверяется сама с собой (`reconcileTasks`);
 *  2. находка `calc`/`logic` на строке с равными ответами — выдумка, долой;
 *     `calc` на `partial` с равными ответами — тоже (арифметической ошибки
 *     при совпавшем ответе не бывает), `logic` на `partial` остаётся —
 *     «ответ верный, ход с изъяном» законен;
 *  3. текстовая страховка «X, а не X» — для любой категории, кроме praise;
 *  4. `calc`/`logic`/`comment` только на строках wrong/partial (comment ещё и
 *     на unchecked — «не разобрал почерк»), не больше одной на строку;
 *     находка без номера задания, если таблица есть, — оставляем: доказать
 *     выдумку нечем, а в сомнении — за находку (её увидит преподаватель);
 *  5. `format` ≤ 2, `praise` ≤ 1 и только при наличии хотя бы одной ошибки;
 *  6. потолок MAX_FINDINGS.
 *
 * Без таблицы (модель её не вернула) работают только шаги 3, 5, 6.
 */
export function filterFindings<T extends FindingDraft>(rawFindings: readonly T[], rawTasks: readonly TaskRow[]): FilterResult<T> {
  const { tasks, lowered } = reconcileTasksDetailed(rawTasks)
  const byNo = new Map<string, TaskRow>()
  for (const t of tasks) byNo.set(t.no.toLowerCase(), t)
  const hasTable = tasks.length > 0
  const hasErrors = tasks.some(t => t.verdict === 'wrong' || t.verdict === 'partial')

  const droppedBy = { contradiction: 0, text: 0, offTable: 0, limit: 0 }
  const usedRows = new Set<string>()
  let formatCount = 0
  let praiseCount = 0
  const kept: T[] = []

  for (const f of rawFindings) {
    const taskNo = (f.task || (hasTable ? taskNoFromText(f.text) : '')).toLowerCase()
    const row = taskNo ? byNo.get(taskNo) : undefined
    const finding: T = { ...f, task: row ? row.no : f.task }

    if (f.category !== 'praise' && isSelfContradictoryText(f.text)) { droppedBy.text += 1; continue }

    if (f.category === 'format') {
      if (formatCount >= MAX_FORMAT_FINDINGS) { droppedBy.limit += 1; continue }
      formatCount += 1
      kept.push(finding)
      continue
    }

    if (f.category === 'praise') {
      // Похвалу решаем после ошибок: «хотя бы одна ошибка» считается по
      // таблице, а без таблицы — по тому, что осталось среди находок.
      kept.push(finding)
      continue
    }

    // calc / logic / comment
    if (row) {
      const equal = compareAnswers(row.student_answer, row.expected_answer) === 'equal'
      if (equal && f.category !== 'comment' && (row.verdict === 'correct' || row.verdict === 'wrong' || f.category === 'calc')) {
        droppedBy.contradiction += 1
        continue
      }
      const allowed = row.verdict === 'wrong' || row.verdict === 'partial'
        || (row.verdict === 'unchecked' && f.category === 'comment')
      if (!allowed) { droppedBy.offTable += 1; continue }
      if (usedRows.has(taskNo)) { droppedBy.limit += 1; continue }
      usedRows.add(taskNo)
    }
    kept.push(finding)
  }

  // Похвала: не больше одной, и только когда есть что исправлять.
  const errorsPresent = hasTable
    ? hasErrors
    : kept.some(f => f.category === 'calc' || f.category === 'logic' || f.category === 'comment')
  const result: T[] = []
  for (const f of kept) {
    if (f.category === 'praise') {
      if (!errorsPresent || praiseCount >= MAX_PRAISE_FINDINGS) { droppedBy.limit += 1; continue }
      praiseCount += 1
    }
    result.push(f)
  }

  // Потолок: ошибки важнее похвалы, поэтому praise уходит в хвост перед срезом.
  const ordered = [...result.filter(f => f.category !== 'praise'), ...result.filter(f => f.category === 'praise')]
  const capped = ordered.slice(0, MAX_FINDINGS)
  droppedBy.limit += ordered.length - capped.length

  const dropped = rawFindings.length - capped.length
  return { kept: capped, tasks, dropped, droppedBy, lowered }
}

// ---------------------------------------------------------------------------
// Уверенность и summary
// ---------------------------------------------------------------------------

export type Confidence = 'high' | 'medium' | 'low'
export type ReferenceStateLike = 'used' | 'missing' | 'failed'

/** Доля несверенных заданий; пустая таблица — ноль, а не деление на ноль. */
export function uncheckedShare(tasks: readonly TaskRow[]): number {
  if (tasks.length === 0) return 0
  return tasks.filter(t => t.verdict === 'unchecked').length / tasks.length
}

/**
 * Прочитана ли работа не целиком (§189).
 *
 * Два признака, и оба означают одно: часть работы до проверки не дошла —
 * страницы не влезли (`pagesSkipped`) или заданий с вердиктом `unchecked`
 * набралось от пятой части. Следствие жёсткое: балл не выводится вовсе и
 * уверенность `low`.
 *
 * Почему не «балл по прочитанному»: живой прогон дал «97, уверенность
 * высокая» по работе, от которой прочитано две трети, — преподаватель ставит
 * такой балл не глядя. Отсутствие балла заставляет его открыть работу, а
 * заниженный или завышенный — нет.
 */
export function isPartialCheck(ctx: { tasks: readonly TaskRow[]; pagesSkipped: boolean }): boolean {
  return ctx.pagesSkipped || uncheckedShare(ctx.tasks) >= UNCHECKED_LOW_CONFIDENCE_SHARE
}

/**
 * Уверенность считается грубо в коде: `low`, если работа нечитаема или
 * проверена не целиком (§189: непрочитанные страницы либо ≥ 20 % несверенных
 * заданий); без эталона потолок `medium` (§137); иначе — как у модели. В
 * выгрузке 15.09 «high» стояло почти везде, включая находки «0,78, а не
 * 0,78», так что слово модели тут — не последнее.
 */
export function deriveConfidence(
  modelValue: unknown,
  ctx: {
    tasks: readonly TaskRow[]
    readable: boolean
    referenceState: ReferenceStateLike
    /** Хоть одна страница работы до модели не доехала. */
    pagesSkipped: boolean
  },
): Confidence | null {
  const value: Confidence | null = ['high', 'medium', 'low'].includes(modelValue as string)
    ? modelValue as Confidence
    : null
  if (!ctx.readable) return 'low'
  if (isPartialCheck(ctx)) return 'low'
  if (!value) return null
  if (ctx.referenceState !== 'used' && value === 'high') return 'medium'
  return value
}

/** Приписка о несверенных заданиях — они не в балле, и преподаватель должен это видеть. */
export function withUncheckedNote(summary: string, tasks: readonly TaskRow[]): string {
  const list = tasks.filter(t => t.verdict === 'unchecked').map(t => t.no)
  if (list.length === 0) return summary
  const note = `Не сверены задания (в балл не вошли): ${list.join(', ')}.`
  return summary ? `${summary}\n\n${note}` : note
}

/**
 * Приписка о понижённых вердиктах (§189).
 *
 * Считать их в `dropped_findings` было бы неправильно: там мера выдумок
 * модели, а здесь — правка, которую преподаватель обязан видеть поимённо.
 * Число в панели пришло не от модели, и молчать об этом нельзя: иначе
 * расхождение «в таблице неверно, а балл высокий» он найдёт сам и перестанет
 * верить обоим.
 */
export function withLoweredNote(summary: string, lowered: readonly string[]): string {
  if (lowered.length === 0) return summary
  const what = lowered.length === 1 ? 'заданию' : 'заданиям'
  const note = `Система поправила вердикт по ${what} ${lowered.join(', ')} (ответ не совпал с ожидаемым).`
  return summary ? `${summary}\n\n${note}` : note
}
