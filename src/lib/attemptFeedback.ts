/**
 * §239. Разбор проверенной попытки глазами ученика: какие рамки учителя к
 * какому заданию относятся, как их нумеровать и какой кусок страницы
 * вырезать под заданием.
 *
 * Модуль чистый — ни сети, ни DOM. Его правила нужны трём местам экрана
 * сразу (карточки заданий, миниатюры страниц, «Общие замечания»), и номер
 * пометки обязан совпадать во всех трёх, а заодно и с «Вся страница →»
 * (аннотатор) и скачиваемым PDF: там рамки считаются по сквозной странице и
 * порядку на странице (`SubmissionReviewer`, слепок `exportSourceRef`).
 *
 * Почему привязка по тексту вообще нужна. Поле `task` у рамки (§209) на проде
 * заполнено у 1 из 226 рамок: почти всё нарисовано до §209 или свободной
 * рамкой. Зато учитель по привычке начинает текст с номера: «Задача 3: …».
 * Без разбора этого начала все замечания ушли бы в «Общие», и под заданием
 * ученик не увидел бы ни одной своей ошибки.
 */

import type { ReviewTaskRow, ReviewTaskVerdict } from './homeworkReviewTasks'
import { compareTaskNo, sortReviewTasks } from './homeworkReviewTasks'
import { noteTaskKey } from './reviewNotes'
import { normalizeQuarter, rotateRatio, rotateRect, type Quarter } from './pageRotation'

export interface FeedbackRect { x: number; y: number; w: number; h: number }

/** Строка `annotation_sets` в том виде, в каком её читает разбор. */
export interface FeedbackAnnotationRow {
  file_path: string | null
  page: number
  data: unknown
}

/** Страница работы в сквозном счёте — как её считает аннотатор. */
export interface FeedbackPage {
  /** Сквозной номер: файл за файлом, страница за страницей. */
  globalPage: number
  fileIndex: number
  filePath: string
  kind: 'image' | 'pdf'
  /** Страница внутри файла (у фото всегда 1). */
  page: number
  /** §211. Поворот страницы — свойство страницы, лежит в том же jsonb. */
  quarter: Quarter
}

export interface FeedbackRegion {
  id: string
  /** Номер пометки: в кружке на миниатюре, в «Пометка N», в «Общих». */
  number: number
  globalPage: number
  fileIndex: number
  filePath: string
  page: number
  quarter: Quarter
  /** Доли ИСХОДНОЙ страницы — как хранятся. */
  rect: FeedbackRect
  /** Доли ПОВЁРНУТОЙ страницы — как видны на экране. */
  displayRect: FeedbackRect
  category: string
  text: string
  /** Поле `task` рамки, как есть. */
  rawTask: string | null
  /** Похвала: зелёная, в «Общих» без тревоги. */
  praise: boolean
  color: string
}

/**
 * Цвета рамок — палитра состояний дизайна v2 (`verdict.*` в tailwind), а не
 * яркие цвета аннотатора: в разборе рамка стоит рядом с плашками вердиктов и
 * обязана читаться тем же языком — красное «ошибка», охра «неточно», зелёное
 * «хорошо».
 */
const CATEGORY_COLOR: Record<string, string> = {
  error: '#b54b43',
  calc: '#b54b43',
  inaccuracy: '#a97416',
  logic: '#7a4fc9',
  format: '#d46a10',
  good: '#33854a',
  praise: '#33854a',
  comment: '#4075aa',
}

export function regionColor(category: string): string {
  return CATEGORY_COLOR[category] ?? CATEGORY_COLOR.comment
}

export function isPraiseCategory(category: string): boolean {
  return category === 'praise' || category === 'good'
}

// ---------------------------------------------------------------------------
// Номер задания из текста
// ---------------------------------------------------------------------------

/**
 * Номер задания в начале текста замечания: «Задача 3: …», «Задача №3 …»,
 * «№3 …», «з.3 …», «Задание 12а — …», «Зад. 4 …».
 *
 * Только НАЧАЛО текста, а не любое упоминание: «Как в задаче 3, здесь…» — это
 * замечание к другому заданию, и приписать его третьему значило бы соврать
 * ученику, где ошибка.
 */
const TASK_PREFIX = /^\s*(?:(?:задач[аеиуы]?|задани[еяю]|зад\.?|з\.)\s*(?:№\s*)?|№\s*)(\d+[a-zа-яё]?)(?![\d])/i

export function taskNoFromText(text: string | null | undefined): string | null {
  const match = TASK_PREFIX.exec(String(text ?? ''))
  return match ? match[1] : null
}

/**
 * Текст без «Задача 3:» в начале — под карточкой задания номер уже написан
 * крупно, повторять его в каждой строке незачем. Первая буква — заглавная.
 */
export function stripTaskPrefix(text: string): string {
  const match = TASK_PREFIX.exec(text)
  if (!match) return text.trim()
  const rest = text.slice(match[0].length).replace(/^[\s:.,—–-]+/, '').trim()
  if (!rest) return text.trim()
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/**
 * Одно ли это замечание. Учитель пишет заметку в таблице и тот же текст —
 * рамкой («Ответ верный, но график не построен» и «Задача 7: ответ верный, но
 * график не построен — условие просит…»). До §239 ученик читал это дважды.
 * Совпадением считаем равенство или вхождение одного в другое после
 * нормализации; короткие куски (меньше 12 знаков) не сравниваем — «Верно»
 * входит почти в любой текст.
 */
function noteKey(text: string): string {
  return stripTaskPrefix(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s  ]+/g, ' ')
    .replace(/[.,;:!?«»"'()—–-]+/g, '')
    .trim()
}

export function sameNote(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = noteKey(String(a ?? ''))
  const kb = noteKey(String(b ?? ''))
  if (!ka || !kb) return false
  if (ka === kb) return true
  const [short, long] = ka.length <= kb.length ? [ka, kb] : [kb, ka]
  return short.length >= 12 && long.includes(short)
}

// ---------------------------------------------------------------------------
// Страницы и рамки
// ---------------------------------------------------------------------------

export interface FeedbackFile {
  /** Путь внутри бакета — тот же, что `annotation_sets.file_path`. */
  path: string
  kind: 'image' | 'pdf'
}

function pageDataOf(raw: unknown): { objects: unknown[]; rotation: Quarter } {
  const value = raw as { objects?: unknown; rotation?: unknown } | null
  return {
    objects: Array.isArray(value?.objects) ? value!.objects as unknown[] : [],
    rotation: normalizeQuarter(value?.rotation),
  }
}

function cleanRect(raw: unknown): FeedbackRect | null {
  const r = raw as Partial<FeedbackRect> | null
  const nums = [r?.x, r?.y, r?.w, r?.h].map(Number)
  if (nums.some(n => !Number.isFinite(n))) return null
  const [x, y, w, h] = nums
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

/**
 * Страницы работы в сквозном счёте и все рамки с номерами.
 *
 * `pdfPages` — сколько страниц в каждом PDF, если документ уже открыт. Пока
 * он не открыт, за длину файла берётся самая большая размеченная страница
 * (то же допущение, что `notesFromAnnotations`): для фото счёт точный всегда.
 *
 * Номера рамок: по сквозной странице, внутри страницы — в порядке хранения.
 * Так же нумерует аннотатор и скачиваемый PDF, поэтому «Пометка 3» в разборе
 * — это кружок «3» и в «Вся страница →», и в файле.
 */
export function buildFeedbackLayout(
  files: readonly FeedbackFile[],
  rows: readonly FeedbackAnnotationRow[],
  pdfPages: Readonly<Record<string, number>> = {},
): { pages: FeedbackPage[]; regions: FeedbackRegion[] } {
  const byKey = new Map<string, unknown>()
  const maxPage = new Map<string, number>()
  for (const row of rows) {
    const path = row.file_path ?? files[0]?.path ?? ''
    const page = Number(row.page) || 1
    byKey.set(`${path}::${page}`, row.data)
    maxPage.set(path, Math.max(maxPage.get(path) ?? 1, page))
  }

  const pages: FeedbackPage[] = []
  let globalPage = 1
  files.forEach((file, fileIndex) => {
    const count = file.kind === 'image' ? 1 : Math.max(1, pdfPages[file.path] ?? maxPage.get(file.path) ?? 1)
    for (let page = 1; page <= count; page += 1) {
      const data = pageDataOf(byKey.get(`${file.path}::${page}`))
      pages.push({ globalPage, fileIndex, filePath: file.path, kind: file.kind, page, quarter: data.rotation })
      globalPage += 1
    }
  })

  const regions: FeedbackRegion[] = []
  for (const p of pages) {
    const data = pageDataOf(byKey.get(`${p.filePath}::${p.page}`))
    for (const raw of data.objects) {
      const object = raw as { id?: unknown; type?: unknown; rect?: unknown; category?: unknown; text?: unknown; task?: unknown }
      if (object?.type !== 'region' || typeof object.id !== 'string') continue
      const rect = cleanRect(object.rect)
      if (!rect) continue
      const category = typeof object.category === 'string' ? object.category : 'comment'
      regions.push({
        id: object.id,
        number: regions.length + 1,
        globalPage: p.globalPage,
        fileIndex: p.fileIndex,
        filePath: p.filePath,
        page: p.page,
        quarter: p.quarter,
        rect,
        displayRect: rotateRect(rect, p.quarter),
        category,
        text: typeof object.text === 'string' ? object.text : '',
        rawTask: typeof object.task === 'string' && object.task.trim() ? object.task.trim() : null,
        praise: isPraiseCategory(category),
        color: regionColor(category),
      })
    }
  }
  return { pages, regions }
}

// ---------------------------------------------------------------------------
// Привязка к заданиям
// ---------------------------------------------------------------------------

/**
 * К какому заданию таблицы относится рамка: поле `task`, иначе номер из
 * начала текста, иначе ни к какому. Номер сверяется со строками таблицы после
 * той же нормализации, что у экрана проверки (`noteTaskKey`: «№ 4», «4.» —
 * одно задание). Номер, которого в таблице нет, — это тоже «ни к какому»:
 * карточки для него нет, и спрятать замечание нельзя.
 */
export function taskKeyOfRegion(
  region: { rawTask: string | null; text: string },
  knownKeys: ReadonlySet<string>,
): string | null {
  if (knownKeys.size === 0) return null
  const own = noteTaskKey(region.rawTask)
  if (own && knownKeys.has(own)) return own
  const fromText = noteTaskKey(taskNoFromText(region.text))
  if (fromText && knownKeys.has(fromText)) return fromText
  return null
}

/** Что надо исправлять: неверно, частично и не решено. */
export const FIX_VERDICTS: readonly ReviewTaskVerdict[] = ['wrong', 'partial', 'unsolved']

export interface FeedbackTask {
  row: ReviewTaskRow
  key: string
  /** Рамки задания, в порядке номеров. */
  regions: FeedbackRegion[]
  /**
   * Заметка из таблицы, если её текст не повторяет ни одну рамку задания;
   * null — заметки нет или она уже показана рамкой.
   */
  note: string | null
}

export interface FeedbackBinding {
  /** Все задания таблицы по порядку. */
  tasks: FeedbackTask[]
  /** Неверные, частичные, не решённые и не сверенные — карточками. */
  cards: FeedbackTask[]
  /** Засчитанные — одной свёрнутой строкой. */
  correct: FeedbackTask[]
  /**
   * «Общие замечания»: рамки без задания и рамки засчитанных заданий (им
   * карточки нет, а сказанное учителем ученик увидеть обязан). У рамки
   * засчитанного задания — его номер для подписи «№9 · стр. 2».
   */
  general: { region: FeedbackRegion; taskNo: string | null }[]
  /** Сколько исправить: неверно + частично + не решено. */
  toFix: number
}

export function bindFeedback(
  rows: readonly ReviewTaskRow[],
  regions: readonly FeedbackRegion[],
): FeedbackBinding {
  const ordered = sortReviewTasks(rows)
  const keys = new Set(ordered.map(r => noteTaskKey(r.no)).filter(Boolean))
  const regionsOf = new Map<string, FeedbackRegion[]>()
  const unbound: FeedbackRegion[] = []
  for (const region of regions) {
    const key = taskKeyOfRegion(region, keys)
    if (!key) { unbound.push(region); continue }
    const list = regionsOf.get(key) ?? []
    list.push(region)
    regionsOf.set(key, list)
  }

  const tasks: FeedbackTask[] = ordered.map(row => {
    const key = noteTaskKey(row.no)
    const own = regionsOf.get(key) ?? []
    const legacy = String(row.note ?? '').trim()
    const note = legacy && !own.some(r => sameNote(r.text, legacy)) ? legacy : null
    return { row, key, regions: own, note }
  })

  const correct = tasks.filter(t => t.row.verdict === 'correct')
  const cards = tasks.filter(t => t.row.verdict !== 'correct')
  const general = [
    ...unbound.map(region => ({ region, taskNo: null as string | null })),
    ...correct.flatMap(t => t.regions.map(region => ({ region, taskNo: t.row.no as string | null }))),
  ].sort((a, b) => a.region.number - b.region.number)

  return {
    tasks,
    cards,
    correct,
    general,
    toFix: tasks.filter(t => FIX_VERDICTS.includes(t.row.verdict)).length,
  }
}

// ---------------------------------------------------------------------------
// Вырезка
// ---------------------------------------------------------------------------

/**
 * Полоса текста в тетради — примерно 1/25 высоты страницы (клетка A4-тетради
 * на фото). Меньше этого отступ вокруг рамки не делаем: строка над ошибкой и
 * под ней — это и есть «где это», без них вырезка читается как обрывок.
 */
export const TEXT_BAND = 0.04
/** Отступ над и под рамкой — доля её собственной высоты. */
export const CROP_PAD = 0.15

/**
 * Какую полосу страницы показывать под заданием: вся ширина листа, по высоте
 * — рамка плюс отступ. Ширину не режем намеренно: ученик узнаёт свою
 * страницу по полям и началу строк, а обрезанный с боков кусок — нет.
 * Доли повёрнутой страницы, 0..1.
 */
export function cropBand(displayRect: FeedbackRect): { top: number; height: number } {
  const pad = Math.max(TEXT_BAND, displayRect.h * CROP_PAD)
  const top = Math.max(0, displayRect.y - pad)
  const bottom = Math.min(1, displayRect.y + displayRect.h + pad)
  return { top, height: Math.max(0.01, bottom - top) }
}

/** Отношение сторон страницы на экране (ширина/высота) с учётом поворота. */
export function shownRatio(naturalRatio: number, quarter: Quarter): number {
  return rotateRatio(naturalRatio, quarter)
}

/** Номера заданий для подписи «№1 и №9», «№1, №3 и №9». */
export function joinTaskNos(nos: readonly string[]): string {
  const list = [...nos].sort(compareTaskNo).map(n => `№${n}`)
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`
}
