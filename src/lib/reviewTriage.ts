/**
 * §238. «Светофор» таблицы проверки: какие задания преподавателю смотреть, а
 * какие можно не открывать.
 *
 * Правила выведены из данных, а не из ощущений: 34 проверенные работы, 336
 * заданий, где есть и черновик ИИ, и вердикт человека. «ИИ: верно, ответ
 * совпал с эталоном» преподаватель менял в 5 % случаев — такие строки
 * зелёные и свёрнуты. «Частично» при совпавшем ответе он менял в 87 % случаев
 * (17 из 20 — на «верно»): модель придумывает претензию, чтобы оправдать
 * «частично», чаще всего к отбору корней на отрезке. Такие строки жёлтые,
 * первые в списке, и по умолчанию предложено «верно».
 *
 * Сравнение ответов — ТОЛЬКО `compareAnswers` из `check-homework-ai/findings.ts`
 * (§189): тот же код, которым сама проверка сверяет свою таблицу. Второй копии
 * нет намеренно — две копии сравнения уже разъезжались (CLAUDE.md, §63/§66).
 * Модуль чистый: без сети и без React, его гоняют тесты и `scripts/svetofor-replay.mjs`.
 */

import { compareAnswers, type AnswerMatch } from '../../supabase/functions/check-homework-ai/findings.ts'
import type { AiTaskRow, AiTaskVerdict } from './aiHomeworkCheck'

export type TriageLight = 'green' | 'yellow'

/**
 * Почему строка жёлтая. Порядок не случаен — это порядок доверия из выгрузки:
 *  - `partial_equal` — «частично», но ответ совпал (87 % правок);
 *  - `answer_differs` — «частично», ответ другой или не сверяется кодом (81 %);
 *  - `unchecked` — ИИ не сверила или этого задания в её таблице нет (75 %);
 *  - `wrong` — «неверно» (38 %);
 *  - `correct_other_form` — «верно», но код ответы не подтвердил (3 %, но
 *    зелёным это назвать нельзя: зелёное — то, что проверил код).
 */
export type TriageReason = 'partial_equal' | 'answer_differs' | 'unchecked' | 'correct_other_form' | 'wrong'

/** Предложенный вердикт — из тех трёх, что стоят на сегменте выбранного задания. */
export type TriageSuggestion = 'correct' | 'partial' | 'wrong'

/**
 * Проверка кодом утверждения ИИ «X (не) входит в [a; b]».
 *
 * `verdict`:
 *  - `false_claim` — утверждение ложно (ИИ пишет «не входит», а входит, или
 *    наоборот). Главный повод для §238;
 *  - `claim_holds` — утверждение верно по факту. Показывается спокойно, без
 *    «ложная»: модель бывает права по факту и неправа по причине.
 */
export interface RootCheck {
  /** Утверждение ИИ, как мы его поняли: «3π не входит в [5π/2; 4π]». */
  claim: string
  /** Число, как оно записано у ИИ: «3π». */
  value: string
  /** Промежуток, как он записан у ИИ: «[5π/2; 4π]». */
  interval: string
  /** Что утверждает ИИ: входит ли X. */
  claimedInside: boolean
  /** Что посчитал код. */
  actual: boolean
  verdict: 'false_claim' | 'claim_holds'
}

export interface RowTriage {
  light: TriageLight
  /** null — у зелёной строки. */
  reason: TriageReason | null
  /** Что предложить преподавателю; null — предлагать нечего («не сверено»). */
  suggested: TriageSuggestion | null
  /** Как код сверил ответ ученика с эталоном. */
  match: AnswerMatch
  rootCheck?: RootCheck
}

export interface ClassifyInput {
  /** Вердикт ИИ по заданию; null — в таблице ИИ этого задания нет. */
  aiVerdict: AiTaskVerdict | null | undefined
  studentAnswer: string | null | undefined
  expectedAnswer: string | null | undefined
  /** Заметка ИИ по заданию — из неё берётся утверждение про отбор корней. */
  note: string | null | undefined
}

/**
 * Строка таблицы — зелёная или жёлтая, почему, и что предложить.
 *
 * Зелёная ровно одна: ИИ сказал «верно» И код подтвердил, что ответ совпал.
 * Всё остальное жёлтое. Проверка отбора корней цвет не меняет — ложная
 * претензия остаётся поводом посмотреть, — но при совпавшем ответе она
 * переводит предложение в «верно».
 */
export function classifyRow(input: ClassifyInput): RowTriage {
  const match = compareAnswers(input.studentAnswer ?? '', input.expectedAnswer ?? '')
  const rootCheck = checkRootClaim(input.note) ?? undefined
  const falseClaim = rootCheck?.verdict === 'false_claim'
  const withCheck = (triage: RowTriage): RowTriage => (rootCheck ? { ...triage, rootCheck } : triage)

  const verdict = input.aiVerdict ?? null
  if (verdict === 'correct') {
    if (match === 'equal') return withCheck({ light: 'green', reason: null, suggested: null, match })
    return withCheck({ light: 'yellow', reason: 'correct_other_form', suggested: 'correct', match })
  }
  if (verdict === 'partial') {
    if (match === 'equal') return withCheck({ light: 'yellow', reason: 'partial_equal', suggested: 'correct', match })
    return withCheck({ light: 'yellow', reason: 'answer_differs', suggested: 'partial', match })
  }
  if (verdict === 'wrong') {
    return withCheck({
      light: 'yellow',
      reason: 'wrong',
      suggested: falseClaim && match === 'equal' ? 'correct' : 'wrong',
      match,
    })
  }
  return withCheck({
    light: 'yellow',
    reason: 'unchecked',
    suggested: falseClaim && match === 'equal' ? 'correct' : null,
    match,
  })
}

/**
 * Порядок жёлтых внутри группы: «частично при совпавшем ответе» — первыми
 * (там больше всего ложных претензий, и там же главное предложение «верно»),
 * остальные — в порядке таблицы. Сортировка по всем причинам сразу
 * перемешала бы номера, а искать задание 9 после 12 — лишнее чтение.
 */
export function triageRank(triage: RowTriage): number {
  if (triage.light === 'green') return 2
  return triage.reason === 'partial_equal' ? 0 : 1
}

// ---------------------------------------------------------------------------
// Заполнение таблицы из ИИ (seed)
// ---------------------------------------------------------------------------

/**
 * Во что превращается строка ИИ при заполнении таблицы преподавателя.
 *
 * Единственное изменение §238: «частично» при совпавшем ответе кладётся как
 * «верно» и БЕЗ заметки. Поле `note` таблицы после вердикта видит ученик
 * (§199: внутреннего поля нет намеренно), а претензия ИИ здесь, как правило,
 * выдумана — ученику её показывать нельзя. Преподаватель видит сомнение ИИ в
 * интерфейсе, из слепка проверки (`topic_homework_ai_jobs.tasks`), как причину
 * жёлтой строки. Балл не снижается, пока человек сам не выберет иначе.
 * Остальные строки — как есть.
 */
export function seededVerdict(task: Pick<AiTaskRow, 'verdict' | 'student_answer' | 'expected_answer' | 'note'>): {
  verdict: AiTaskVerdict
  note: string | null
} {
  const note = String(task.note ?? '').trim()
  if (isPartialEqual(task)) return { verdict: 'correct', note: null }
  return { verdict: task.verdict, note: note || null }
}

function isPartialEqual(task: { verdict: string; student_answer?: string | null; expected_answer?: string | null }): boolean {
  return task.verdict === 'partial'
    && compareAnswers(task.student_answer ?? '', task.expected_answer ?? '') === 'equal'
}

/**
 * Что записать по кнопке «Поставить …» у жёлтой строки.
 *
 * Для «верно» заметка очищается, но ТОЛЬКО если в ней дословно текст ИИ по
 * этому заданию (старые таблицы, заполненные до §238, несут претензию модели
 * в `note`, и с вердиктом «верно» ученик прочёл бы её как замечание). Если
 * текст другой — его писал преподаватель, и он остаётся. Для остальных
 * предложений заметка не трогается: объяснение ошибки ученику нужно.
 */
export function acceptSuggestionPatch(
  suggested: TriageSuggestion,
  rowNote: string | null | undefined,
  aiNote: string | null | undefined,
): { verdict: TriageSuggestion; note?: null } {
  const ai = String(aiNote ?? '').trim()
  if (suggested === 'correct' && ai && String(rowNote ?? '').trim() === ai) {
    return { verdict: suggested, note: null }
  }
  return { verdict: suggested }
}

// ---------------------------------------------------------------------------
// Проверка отбора корней
// ---------------------------------------------------------------------------

const EPS = 1e-9

/**
 * Число из записи ИИ: `3π`, `5π/2`, `-π/4`, `15π/4`, `π`, `2`, `0,5`, `7/2`,
 * `3*pi/2`. Всё, что сложнее (скобки, корни, `πk`), — `null`: гадать не
 * будем.
 */
export function parseMathValue(raw: string): number | null {
  const s = normalizeMath(raw).replace(/\s+/g, '').replace(/,/g, '.')
  const m = /^([+-])?(\d+(?:\.\d+)?)?(\*)?(π)?(?:\/(\d+(?:\.\d+)?))?$/.exec(s)
  if (!m) return null
  const [, sign, num, star, pi, den] = m
  if (!num && !pi) return null
  if (star && (!num || !pi)) return null
  let value = num ? Number(num) : 1
  if (pi) value *= Math.PI
  if (den) {
    const d = Number(den)
    if (!d) return null
    value /= d
  }
  if (!Number.isFinite(value)) return null
  return sign === '-' ? -value : value
}

/** Промежуток из записи: `[5π/2; 4π]`, `(0; 7π/2]`, `[-2π, -π]`. */
export interface ParsedInterval {
  lo: number
  hi: number
  loClosed: boolean
  hiClosed: boolean
  text: string
}

export function parseInterval(raw: string): ParsedInterval | null {
  const re = new RegExp(`^${INTERVAL}$`)
  const m = re.exec(normalizeMath(raw).trim())
  return m ? intervalFromMatch(m, 1) : null
}

/** Входит ли x в промежуток — с допуском на плавающую точку у границ. */
export function inInterval(x: number, interval: ParsedInterval): boolean {
  const aboveLo = interval.loClosed ? x >= interval.lo - EPS : x > interval.lo + EPS
  const belowHi = interval.hiClosed ? x <= interval.hi + EPS : x < interval.hi - EPS
  return aboveLo && belowHi
}

/**
 * Утверждение ИИ про отбор корней — и что о нём думает код. `null` — в
 * заметке такого утверждения нет или его не удалось разобрать однозначно.
 *
 * Понимаем три формы (все взяты из настоящих заметок модели):
 *  1. «X не входит в [a; b]» / «входит», «(не) принадлежит», «(не) лежит»,
 *     «(не) попадает», между глаголом и промежутком — «в отрезок», «на
 *     заданном промежутке» и т. п. без скобок;
 *  2. «X ∉ [a; b]» / «X ∈ [a; b]»;
 *  3. «ученик включил X, хотя интервал открытый» — если в заметке ровно один
 *     промежуток: ИИ утверждает, что X в него не входит.
 * Утверждений несколько — первое ложное важнее первого верного: ради ложных
 * проверка и заводилась.
 */
export function checkRootClaim(note: string | null | undefined): RootCheck | null {
  const text = normalizeMath(note)
  if (!text.trim()) return null

  const checks: RootCheck[] = []
  const add = (valueRaw: string, intervalMatch: RegExpExecArray, offset: number, claimedInside: boolean) => {
    const value = parseMathValue(valueRaw)
    const interval = intervalFromMatch(intervalMatch, offset)
    if (value == null || !interval) return
    const actual = inInterval(value, interval)
    const shown = pretty(valueRaw.trim())
    checks.push({
      claim: `${shown} ${claimedInside ? 'входит' : 'не входит'} в ${interval.text}`,
      value: shown,
      interval: interval.text,
      claimedInside,
      actual,
      verdict: actual === claimedInside ? 'claim_holds' : 'false_claim',
    })
  }

  // 1. «X (не) входит … [a; b]»
  const verbRe = new RegExp(
    `${VALUE_START}(${VALUE})${VALUE_END}\\s*(?:\\)\\s*)?,?\\s*(не\\s+)?(?:входит|входят|принадлежит|принадлежат|лежит|лежат|попадает|попадают)(?:\\s+(?:в|на|во))?[^\\[\\]();.]{0,40}?${INTERVAL}`,
    'gi',
  )
  for (const m of text.matchAll(verbRe)) {
    add(m[1], m as unknown as RegExpExecArray, 3, !m[2])
  }

  // 2. «X ∉ [a; b]»
  const symRe = new RegExp(`${VALUE_START}(${VALUE})${VALUE_END}\\s*(∉|∈)\\s*${INTERVAL}`, 'g')
  for (const m of text.matchAll(symRe)) {
    add(m[1], m as unknown as RegExpExecArray, 3, m[2] === '∈')
  }

  // 3. «включил X, хотя интервал открытый» при единственном промежутке.
  if (checks.length === 0 && /открыт/i.test(text)) {
    const intervals = [...text.matchAll(new RegExp(INTERVAL, 'g'))]
    const included = new RegExp(`включ\\S*\\s+(?:корень\\s+|значение\\s+)?(?:x\\s*=\\s*)?${VALUE_START}(${VALUE})${VALUE_END}`, 'i').exec(text)
    if (intervals.length === 1 && included) {
      add(included[1], intervals[0] as unknown as RegExpExecArray, 1, false)
    }
  }

  return checks.find(check => check.verdict === 'false_claim') ?? checks[0] ?? null
}

/**
 * Число в тексте: знак, коэффициент, π, знаменатель. Коэффициент с
 * десятичной запятой («0,5») допускается только без пробела после запятой —
 * иначе «[0, 1]» стал бы одним числом.
 */
const VALUE = String.raw`[-+]?\s?(?:\d+(?:[.,]\d+)?\s?\*?\s?π?|π)(?:\s?\/\s?\d+(?:[.,]\d+)?)?`
/** Перед числом не цифра, не буква, не дробь: «2πk», «x/3π» мимо. */
const VALUE_START = String.raw`(?<![\wπ.,/*-])`
/** После числа не буква и не π: «3πk» — не «3π». */
const VALUE_END = String.raw`(?![\wπа-яё])`
/** Промежуток: четыре вида скобок, разделитель «;» или «,». Три группы: скобка, a, b, скобка. */
const INTERVAL = String.raw`([\[(])\s*(${VALUE})\s*[;,]\s*(${VALUE})\s*([\])])`

function intervalFromMatch(m: RegExpExecArray | RegExpMatchArray, offset: number): ParsedInterval | null {
  const open = m[offset]
  const a = m[offset + 1]
  const b = m[offset + 2]
  const close = m[offset + 3]
  if (!open || a == null || b == null || !close) return null
  const lo = parseMathValue(a)
  const hi = parseMathValue(b)
  if (lo == null || hi == null || lo > hi + EPS) return null
  return {
    lo,
    hi,
    loClosed: open === '[',
    hiClosed: close === ']',
    text: `${open}${pretty(a.trim())}; ${pretty(b.trim())}${close}`,
  }
}

/** Разные минусы, «pi» и «Пи» — к одному виду; «ё» к «е». */
function normalizeMath(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/[−‒]/g, '-')
    // Тире — минус, только когда стоит вплотную к числу: «— 3π» это тире в
    // предложении, «–3π» — минус.
    .replace(/[–—](?=[\dπ])/g, '-')
    .replace(/\bpi\b/gi, 'π')
    .replace(/(\d)\s?pi/gi, '$1π')
    .replace(/Ё/g, 'Е')
    .replace(/ё/g, 'е')
}

/** Как показать число человеку: минус типографский, без пробелов внутри. */
function pretty(raw: string): string {
  return raw.replace(/\s+/g, '').replace(/^-/, '−').replace(/\*/g, '')
}

/**
 * §238. Правки к только что заполненной таблице: строки «частично» при
 * совпавшем ответе → «верно», заметка ИИ стирается (см. `seededVerdict`).
 *
 * Заполняет таблицу RPC в базе (`topic_homework_review_tasks_seed`, §199), а
 * сравнивать ответы в SQL значило бы завести вторую копию `compareAnswers`.
 * Поэтому правило применяет клиент — сразу после того, как ЕГО вызов RPC
 * создал строки, и только к ним: уже заполненные таблицы не переписываются.
 * `note` в ответе — что лежит в строке сейчас (текст ИИ из RPC): запись
 * условная и по нему тоже, чтобы не стереть заметку, которую успел написать
 * человек.
 */
export function seedDoubtPatches(rows: readonly {
  id: string
  verdict: string
  student_answer: string | null
  expected_answer: string | null
  note: string | null
}[]): Array<{ id: string; note: string | null; patch: { verdict: 'correct'; note: null } }> {
  const out: Array<{ id: string; note: string | null; patch: { verdict: 'correct'; note: null } }> = []
  for (const row of rows) {
    if (isPartialEqual(row)) out.push({ id: row.id, note: row.note, patch: { verdict: 'correct', note: null } })
  }
  return out
}
