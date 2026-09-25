/**
 * §215. Ввод результатов пробника: правила строки ученика.
 *
 * Модуль чистый — ни DOM, ни сети. Сюда вынесено всё, что модалка раньше
 * решала по ходу дела и чего поэтому нельзя было проверить: что считается
 * заполненной строкой, какой ввод неверен и почему, и кому из учеников
 * уведомление действительно полагается.
 *
 * ── Почему это отдельный модуль ───────────────────────────────────────────
 *
 * До §215 модалка писала в колонку `feedback`, которой в `mock_exam_results`
 * нет (там `notes`), и каждое сохранение кончалось `alert` с текстом ошибки
 * базы. За три месяца при девяти заведённых пробниках в таблице осталось
 * ноль строк. Правила ввода жили внутри той же функции сохранения и не
 * проверялись ничем; теперь они здесь и под тестами.
 */

/** Поле строки, к которому относится ошибка. `parts` — обе части сразу. */
export type MockExamField = 'score' | 'part1' | 'part2' | 'parts'

export interface MockExamRowError {
  field: MockExamField
  message: string
}

/** Что преподаватель набрал в строке. Всё строками: это поля ввода. */
export interface MockExamResultDraft {
  score: string
  part1: string
  part2: string
  notes: string
}

/** Что уедет в `mock_exam_results` — именами колонок, а не выдуманными. */
export interface MockExamResultValue {
  score: number
  part1_score: number | null
  part2_score: number | null
  notes: string | null
}

export interface MockExamRowCheck {
  /** Строка целиком пуста — её просто не сохраняем, это не ошибка. */
  blank: boolean
  value: MockExamResultValue | null
  error: MockExamRowError | null
}

const blankText = (value: string) => String(value ?? '').trim() === ''

/**
 * Целое из поля ввода. `parseInt` здесь не годится: он читает «12abc» как 12
 * и «1.5» как 1, то есть молча принимает то, чего человек не писал.
 */
function integerOf(raw: string): number | null {
  const text = String(raw ?? '').trim().replace(',', '.')
  if (text === '') return null
  if (!/^[+-]?\d+$/.test(text)) return NaN
  return Number(text)
}

/** Пустая строка — ни балла, ни частей, ни заметки. */
export function isBlankRow(draft: MockExamResultDraft): boolean {
  return blankText(draft.score) && blankText(draft.part1)
    && blankText(draft.part2) && blankText(draft.notes)
}

/**
 * Проверка строки перед сохранением.
 *
 * Порядок правил — порядок чтения слева направо: сначала общий балл, потом
 * части, потом их сумма. Ошибка возвращается ОДНА и с указанием поля: она
 * встаёт подписью под этим полем, а не всплывает `alert`-ом с текстом из
 * базы, который преподавателю ничего не говорит.
 */
export function checkResultRow(draft: MockExamResultDraft, maxScore: number): MockExamRowCheck {
  if (isBlankRow(draft)) return { blank: true, value: null, error: null }

  const limit = Number.isFinite(maxScore) && maxScore > 0 ? Math.trunc(maxScore) : 0
  const fail = (field: MockExamField, message: string): MockExamRowCheck =>
    ({ blank: false, value: null, error: { field, message } })

  // Общий балл обязателен: строка без него не сохраняется. Заметка или часть
  // без балла — это не «ничего не ввели», а недоделанный ввод, и молча его
  // терять нельзя.
  const score = integerOf(draft.score)
  if (score === null) return fail('score', 'Впишите общий балл')
  if (Number.isNaN(score)) return fail('score', 'Только целое число')
  if (score < 0) return fail('score', 'Балл не может быть отрицательным')
  if (score > limit) return fail('score', `Не больше ${limit}`)

  // Части необязательные: деление на первую и вторую есть не у каждого
  // пробника.
  const parts: { field: 'part1' | 'part2'; value: number | null }[] = []
  for (const field of ['part1', 'part2'] as const) {
    const part = integerOf(draft[field])
    if (part === null) {
      parts.push({ field, value: null })
      continue
    }
    if (Number.isNaN(part)) return fail(field, 'Только целое число')
    if (part < 0) return fail(field, 'Балл не может быть отрицательным')
    if (part > limit) return fail(field, `Не больше ${limit}`)
    parts.push({ field, value: part })
  }

  const [part1, part2] = parts.map(p => p.value)
  if ((part1 ?? 0) + (part2 ?? 0) > score) {
    return fail('parts', 'Сумма частей больше общего балла')
  }

  return {
    blank: false,
    error: null,
    value: {
      score,
      part1_score: part1,
      part2_score: part2,
      notes: blankText(draft.notes) ? null : draft.notes.trim(),
    },
  }
}

/**
 * Кому слать уведомление о результате.
 *
 * До §215 слалось по ВСЕМ заполненным строкам при каждом сохранении:
 * преподаватель правил одну опечатку — и вся группа получала повторное
 * «результат пробника» второй раз. Шлём только тем, у кого балл появился
 * впервые или изменился.
 *
 * Части и заметка на это не влияют намеренно: в уведомлении стоит балл, и
 * будить ученика ради правки заметки, которую он в уведомлении не увидит,
 * не за чем.
 */
export function scoreIsNew(
  next: MockExamResultValue,
  loaded: { score: number } | null | undefined,
): boolean {
  if (!loaded) return true
  return loaded.score !== next.score
}
