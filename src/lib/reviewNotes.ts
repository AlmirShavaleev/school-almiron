/**
 * §209. Замечание — это рамка на работе, привязанная к заданию.
 *
 * До §209 на экране проверки жили две сущности с почти одинаковым смыслом:
 * поле `note` строки таблицы («заметка») и рамка на работе («комментарий»).
 * Из-за них экран читался как два документа: одно и то же замечание надо было
 * искать то в таблице, то в правой колонке. Владелец: «именно комментарий к
 * задаче показывается рамкой на работе».
 *
 * Поэтому единственная сущность — **задание**, а замечание — регион в
 * `annotation_sets.data.objects[]` с номером задания в поле `task`. Место в
 * jsonb есть, схему менять не надо, миграции нет.
 *
 * Поле `note` не выбрасывается: старые заметки показываются под строкой как
 * замечание без места (`legacy: true`), удалить их можно, завести новое такое
 * — нельзя. Колонка в базе остаётся: у трёх сотен проверенных работ это
 * единственный текст, который видел ученик.
 *
 * Модуль чистый: ни DOM, ни сети. Здесь живут правила, которые иначе
 * разъехались бы по экрану проверки, ученическому разбору и PDF-экспорту —
 * а им всем нужны ОДНИ И ТЕ ЖЕ замечания (иначе экспорт молча обеднеет).
 */

/**
 * Тип замечания. Их три, а не пять: «больше градаций — больше думать на
 * каждом клике», и на практике преподаватель различает ровно «ошибка»,
 * «мелочь» и «молодец».
 */
export type NoteType = 'error' | 'inaccuracy' | 'good'

export interface NoteTypeInfo {
  id: NoteType
  label: string
  /** Цвет рамки на работе и значка в списке. */
  color: string
}

export const NOTE_TYPES: readonly NoteTypeInfo[] = [
  { id: 'error', label: 'Ошибка', color: '#dc2626' },
  { id: 'inaccuracy', label: 'Неточность', color: '#d97706' },
  { id: 'good', label: 'Хорошо', color: '#16a34a' },
]

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  error: 'Ошибка',
  inaccuracy: 'Неточность',
  good: 'Хорошо',
}

/**
 * Замечание в том виде, в каком его показывают экран проверки, ученический
 * разбор и последняя страница PDF. Одна форма на три места намеренно: три
 * копии этой склейки разъехались бы на первой же правке, и экспорт начал бы
 * показывать не то, что экран.
 */
export interface ReviewNote {
  /** id региона (`annotation_sets.data.objects[].id`) либо id строки таблицы. */
  id: string
  /** Номер задания; null — замечание ни к какому заданию не привязано. */
  taskNo: string | null
  text: string
  /** Сквозная страница работы; null — легаси-заметка, места на работе у неё нет. */
  page: number | null
  /** Тип из трёх; null — старая рамка с категорией, которой в тройке нет. */
  type: NoteType | null
  /** Как назвать замечание, когда типа из тройки нет («Логическая ошибка»). */
  categoryLabel: string
  /** Легаси `note` строки таблицы: показать и дать удалить, новых не заводить. */
  legacy?: boolean
}

// ---------------------------------------------------------------------------
// Сравнение ответов
// ---------------------------------------------------------------------------

/**
 * Ответ к сравнению: `3,5` и `3.5` — одно и то же, `−2` и `-2` — тоже.
 *
 * Модель пишет запятую, ученик точку, эталон приходит из PDF с неразрывными
 * пробелами и минусом U+2212. Без нормализации таблица показывала ложное
 * расхождение на каждой второй строке, и преподаватель разбирал глазами то,
 * чего нет.
 */
export function normalizeAnswer(raw: string | null | undefined): string {
  return String(raw ?? '')
    // Все виды пробелов, включая неразрывный и узкий: «12 м/с» и «12м/с».
    .replace(/[\s    ]+/g, '')
    .replace(/,/g, '.')
    // Минус U+2212, среднее и длинное тире, цифровое тире — все в дефис.
    .replace(/[−‒–—]/g, '-')
    .toLowerCase()
}

/** Один и тот же ответ с точностью до записи. */
export function answersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeAnswer(a) === normalizeAnswer(b)
}

/**
 * Что печатать в колонке ответов.
 *
 * Правила владельца: ожидаемый печатается только когда отличается (совпало —
 * одно число), а вместо пустого поля с обрезанным «ожид…» — прочерк.
 */
export interface AnswerView {
  /** Ответ ученика; `—`, если его нет. */
  student: string
  /** Ожидаемый; null — печатать нечего (совпал либо обоих нет). */
  expected: string | null
}

export function answerView(
  student: string | null | undefined,
  expected: string | null | undefined,
): AnswerView {
  const s = String(student ?? '').trim()
  const e = String(expected ?? '').trim()
  if (!s && !e) return { student: '—', expected: null }
  if (!s) return { student: '—', expected: e }
  if (!e) return { student: s, expected: '—' }
  return { student: s, expected: answersMatch(s, e) ? null : e }
}

/** Ученический вид: свой ответ ученику не показываем (§209), только правильный. */
export function expectedOnlyView(expected: string | null | undefined): string {
  const e = String(expected ?? '').trim()
  return e || '—'
}

// ---------------------------------------------------------------------------
// Замечания по заданиям
// ---------------------------------------------------------------------------

/** Номер задания к сравнению: «№ 4», «4.», «4 » — одно задание. */
export function noteTaskKey(raw: string | null | undefined): string {
  return String(raw ?? '').toLowerCase().replace(/[\s№.]/g, '')
}

/** Замечания одного задания — в том порядке, в каком они пришли. */
export function notesOfTask(notes: readonly ReviewNote[], no: string): ReviewNote[] {
  const key = noteTaskKey(no)
  if (!key) return []
  return notes.filter(note => noteTaskKey(note.taskNo) === key)
}

/** Замечания, не привязанные ни к одному заданию таблицы. */
export function orphanNotes(
  notes: readonly ReviewNote[],
  rows: readonly { no: string }[],
): ReviewNote[] {
  const known = new Set(rows.map(row => noteTaskKey(row.no)).filter(Boolean))
  return notes.filter(note => {
    const key = noteTaskKey(note.taskNo)
    return !key || !known.has(key)
  })
}

/**
 * Вердикт спорит с замечанием.
 *
 * Стоит «верно», а в замечании «ошибка в отборе корней» — это не мусор,
 * который надо спрятать: это ровно то, ради чего таблицу открывают. Спор
 * считаем по типу замечания, а у старых рамок и легаси-заметок типа нет —
 * поэтому «не «Хорошо»» и есть признак спора: молчание тут дороже ложной
 * подсветки.
 */
export function verdictConflictsWithNotes(
  verdict: string,
  notes: readonly ReviewNote[],
): boolean {
  if (verdict !== 'correct') return false
  return notes.some(note => note.type !== 'good' && String(note.text ?? '').trim().length > 0)
}

export const VERDICT_CONFLICT_LABEL = 'вердикт и замечание расходятся'

/**
 * §212. Ответ разошёлся с эталоном.
 *
 * Отличается от `answerView().expected != null` одним случаем, и он важный:
 * когда эталона нет вовсе, `answerView` печатает прочерк — это отсутствие
 * сведений, а не расхождение, и подсвечивать такую строку красным значило бы
 * звать смотреть туда, где смотреть не на что.
 */
export function answersDiverge(
  student: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const s = String(student ?? '').trim()
  const e = String(expected ?? '').trim()
  if (!s || !e) return false
  return !answersMatch(s, e)
}

/** Чем подсвечена строка задания: ничем, расхождением или спором. */
export type ReviewRowTone = 'none' | 'mismatch' | 'conflict'

/**
 * §212. Вся строка красится, а не один значок.
 *
 * Владелец: три проблемных задания из двадцати должны цепляться глазом без
 * чтения. Спор вердикта с замечанием выше расхождения ответов: он реже и
 * требует решения человека, а расхождение ответов часто и так видно в
 * колонке «12 → 30».
 *
 * «Неверно» красится и тогда, когда ответы сошлись: вердикт поставил человек,
 * и он главнее сверки чисел — ошибка могла быть в ходе решения.
 */
export function reviewRowTone(
  row: { verdict: string; student_answer?: string | null; expected_answer?: string | null },
  notes: readonly ReviewNote[],
): ReviewRowTone {
  if (verdictConflictsWithNotes(row.verdict, notes)) return 'conflict'
  if (row.verdict === 'wrong' || answersDiverge(row.student_answer, row.expected_answer)) {
    return 'mismatch'
  }
  return 'none'
}

// ---------------------------------------------------------------------------
// Находки ИИ — предложения, а не замечания
// ---------------------------------------------------------------------------

/**
 * Находка, которую ещё не приняли и не отклонили.
 *
 * Выбрасывать находки совсем нельзя — модель часто права, а работа по их
 * получению уже оплачена; тащить их в замечания автоматически тоже нельзя —
 * именно от этого мусора владелец и просил избавиться. Отсюда третье
 * состояние: предложение, живущее до решения человека.
 *
 * Отказ помнится (`dismissed`), иначе «мимо» возвращалось бы при каждом
 * открытии работы. Принятая находка узнаётся по рамке с пометкой источника
 * (§207) — по ней же перенос отличает свои рамки от ручных.
 */
export function pendingFindings<T extends { id: string }>(
  findings: readonly T[],
  takenFindingIds: Iterable<string>,
  dismissedFindingIds: Iterable<string>,
): T[] {
  const taken = new Set(takenFindingIds)
  const dismissed = new Set(dismissedFindingIds)
  return findings.filter(f => !taken.has(f.id) && !dismissed.has(f.id))
}

// ---------------------------------------------------------------------------
// Замечания из `annotation_sets`
// ---------------------------------------------------------------------------

/** Строка `annotation_sets` в том виде, в каком её читают экраны разбора. */
export interface AnnotationPageRow {
  attempt_id?: string | null
  file_path: string | null
  page: number
  data: unknown
}

/** Подписи категорий рамок — те же слова, что в аннотаторе. */
const CATEGORY_LABEL: Record<string, string> = {
  error: 'Ошибка',
  inaccuracy: 'Неточность',
  good: 'Хорошо',
  comment: 'Комментарий',
  calc: 'Вычислительная ошибка',
  logic: 'Логическая ошибка',
  format: 'Оформление',
  praise: 'Отлично',
}

/** Категория рамки → тип из тройки; у старых категорий типа нет. */
export function noteTypeOfCategory(category: string | null | undefined): NoteType | null {
  if (category === 'error' || category === 'inaccuracy' || category === 'good') return category
  return null
}

/**
 * Замечания из пометок работы.
 *
 * Сквозной номер страницы считается тем же правилом, что в аннотаторе: файлы
 * идут в порядке `orderedPaths`, страницы внутри файла — по возрастанию.
 * Сколько в PDF страниц, отсюда не видно (движок не поднят), поэтому за длину
 * файла берётся самая большая размеченная страница. Для фотографий — а это
 * почти все работы — счёт точный; для PDF, размеченного не до конца, номер
 * следующего файла может оказаться меньше настоящего. Врать числом хуже, чем
 * не показать его, но и молчать про место нельзя: ученик ищет рамку глазами.
 */
export function notesFromAnnotations(
  rows: readonly AnnotationPageRow[],
  orderedPaths: readonly string[],
): ReviewNote[] {
  const pagesOf = new Map<string, number>()
  for (const row of rows) {
    const path = row.file_path ?? ''
    pagesOf.set(path, Math.max(pagesOf.get(path) ?? 1, Number(row.page) || 1))
  }
  const offset = new Map<string, number>()
  let running = 0
  for (const path of orderedPaths) {
    offset.set(path, running)
    running += pagesOf.get(path) ?? 1
  }

  const out: ReviewNote[] = []
  for (const row of rows) {
    const objects = (row.data as { objects?: unknown[] } | null)?.objects
    if (!Array.isArray(objects)) continue
    for (const raw of objects) {
      const object = raw as {
        id?: unknown; type?: unknown; text?: unknown; category?: unknown; task?: unknown
      }
      if (object?.type !== 'region' || typeof object.id !== 'string') continue
      const path = row.file_path ?? ''
      const base = offset.get(path)
      const category = typeof object.category === 'string' ? object.category : 'comment'
      out.push({
        id: object.id,
        taskNo: typeof object.task === 'string' && object.task.trim() ? object.task.trim() : null,
        text: typeof object.text === 'string' ? object.text : '',
        page: base == null ? null : base + (Number(row.page) || 1),
        type: noteTypeOfCategory(category),
        categoryLabel: CATEGORY_LABEL[category] ?? 'Замечание',
      })
    }
  }
  return out.sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
}

// ---------------------------------------------------------------------------
// Пакетное действие
// ---------------------------------------------------------------------------

/**
 * Сколько «не сверено» в таблице. Кнопка «Все не сверенные — верные»
 * показывается только когда их больше одной: ради одной строки кнопка не
 * экономит нажатий, а место и внимание занимает.
 */
export function uncheckedIds(rows: readonly { id: string; verdict: string }[]): string[] {
  return rows.filter(row => row.verdict === 'unchecked').map(row => row.id)
}
