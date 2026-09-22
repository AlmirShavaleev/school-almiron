/**
 * §206. Последняя страница скачанного PDF — разбор работы.
 *
 * Модуль чистый: он не рисует, а раскладывает. На выходе — список страниц, в
 * каждой плоский список примитивов (`текст`, `прямоугольник`, `кружок`,
 * `линия`) с готовыми координатами. Рисует их `attemptPdfRender`, дважды и
 * одинаково: на канве браузера и, если понадобится, где угодно ещё.
 *
 * Такое разделение сделано не ради красоты. Раскладка — это то, что ломается
 * содержательно: раздел без строк не должен печатать пустой заголовок, а
 * длинный разбор обязан продолжиться на следующем листе, а не обрезаться. Всё
 * это проверяется тестом только если считать раскладку отдельно от canvas,
 * который в vitest всё равно заглушка.
 *
 * Координаты — в логических пикселях листа A4 при 96 dpi (794 × 1123).
 * Растр может быть плотнее: `attemptPdfRender` домножает на свой масштаб.
 */

import { REVIEW_TASK_VERDICT_LABEL } from './homeworkReviewTasks'
import type { ReviewTaskRow, ReviewTaskVerdict } from './homeworkReviewTasks'
import { answerView, expectedOnlyView, notesOfTask, type ReviewNote } from './reviewNotes'

/** Лист A4 в логических пикселях при 96 dpi. */
export const REPORT_PAGE_WIDTH = 794
export const REPORT_PAGE_HEIGHT = 1123
export const REPORT_MARGIN = 48
export const REPORT_CONTENT_WIDTH = REPORT_PAGE_WIDTH - REPORT_MARGIN * 2

const INK = '#0f172a'
const MUTED = '#64748b'
const FAINT = '#94a3b8'
const RULE = '#e2e8f0'

/** Тон вердикта строки задания — те же цвета, что у значков в таблице проверки. */
const TASK_TONE: Record<ReviewTaskVerdict, string> = {
  correct: '#047857',
  wrong: '#b91c1c',
  partial: '#b45309',
  unchecked: '#64748b',
  // §214. Тот же синий, что у значка «не решено» в таблице и в разборе у
  // ученика: файл обязан читаться так же, как экран, с которого он собран.
  unsolved: '#0369a1',
}

export interface AttemptPdfComment {
  /** Номер, он же цифра в кружке на странице работы. */
  number: number
  /** Сквозной номер страницы работы, где стоит рамка. */
  globalPage: number
  categoryLabel: string
  color: string
  text: string
  /** §209. Задание, к которому привязано замечание; null — ничьё. */
  taskNo?: string | null
}

export interface AttemptPdfReport {
  studentName: string
  homeworkTitle: string
  topicTitle?: string | null
  /** ISO-время сдачи попытки. */
  submittedAt?: string | null
  /** ISO-время вердикта. */
  reviewedAt?: string | null
  decision?: 'accepted' | 'returned_for_revision' | null
  score?: number | null
  scoreMax?: number | null
  comment?: string | null
  tasks?: readonly ReviewTaskRow[]
  /**
   * §209. Кому файл. У ученика в разборе не печатается его собственный ответ:
   * ИИ читает почерк с ошибками, и «твой ответ: 0,375», когда он написал
   * другое, — спор на ровном месте. Преподаватель скачивает своё целиком.
   */
  audience?: 'staff' | 'student'
}

/**
 * Сборка данных разбора из того, что уже лежит на экране. Одна на все три
 * двери в разбор (карточка ученика у преподавателя, очередь проверок, кабинет
 * ученика): три копии этой склейки разошлись бы на первой же правке.
 */
export function attemptPdfReportFrom(input: {
  studentName: string
  homeworkTitle: string
  topicTitle?: string | null
  submittedAt: string | null
  review: { decision: 'accepted' | 'returned_for_revision'; comment: string | null; score: number | null; created_at: string } | null
  scoreMax: number | null
  tasks: readonly ReviewTaskRow[]
  audience?: 'staff' | 'student'
}): AttemptPdfReport {
  return {
    studentName: input.studentName,
    homeworkTitle: input.homeworkTitle,
    topicTitle: input.topicTitle ?? null,
    submittedAt: input.submittedAt,
    reviewedAt: input.review?.created_at ?? null,
    decision: input.review?.decision ?? null,
    score: input.review?.score ?? null,
    scoreMax: input.scoreMax,
    comment: input.review?.comment ?? null,
    tasks: input.tasks,
    audience: input.audience ?? 'staff',
  }
}

export type ReportDraw =
  | { kind: 'text'; x: number; y: number; text: string; size: number; bold?: boolean; color: string; align?: 'left' }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; radius?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'line'; x: number; y: number; w: number; color: string }

/** Ширина строки в логических пикселях. В браузере это `ctx.measureText`. */
export type TextMeasure = (text: string, size: number, bold: boolean) => number

/** Разбивка абзаца по ширине. Слово длиннее строки режется по буквам. */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  bold: boolean,
  measure: TextMeasure,
): string[] {
  const out: string[] = []
  for (const paragraph of String(text ?? '').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (measure(candidate, size, bold) <= maxWidth || !line) {
        // Слово не влезает даже в пустую строку — режем его по буквам, иначе
        // длинная формула без пробелов уехала бы за край листа.
        if (!line && measure(candidate, size, bold) > maxWidth) {
          let chunk = ''
          for (const char of word) {
            if (chunk && measure(chunk + char, size, bold) > maxWidth) {
              out.push(chunk)
              chunk = char
            } else {
              chunk += char
            }
          }
          line = chunk
          continue
        }
        line = candidate
      } else {
        out.push(line)
        line = word
      }
    }
    if (line) out.push(line)
  }
  return out.length > 0 ? out : ['']
}

function formatMoment(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return `${date.toLocaleDateString('ru-RU')}, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
}

/** Дата для имени файла — «18.09.2026». */
export function formatFileDate(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date()
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  const dd = String(safe.getDate()).padStart(2, '0')
  const mm = String(safe.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${safe.getFullYear()}`
}

/** «Иванов Иван Петрович» → «Иванов И.». Одно слово остаётся как есть. */
export function shortStudentName(fullName: string): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Ученик'
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`
}

/**
 * Имя скачиваемого файла. Дата — дата сдачи работы: по ней её и ищут потом.
 * Символы, запрещённые в именах файлов, заменяются на дефис — иначе браузер
 * молча сохранит файл под своим именем.
 */
export function attemptPdfFileName(studentName: string, submittedAt: string | null | undefined): string {
  const safe = shortStudentName(studentName).replace(/[\\/:*?"<>|]/g, '-')
  return `Работа — ${safe} — ${formatFileDate(submittedAt)}.pdf`
}

/**
 * Ученику кнопка нужна только после вердикта: до него он смотрит черновик
 * проверки, и правило то же, что у таблицы заданий (§199) — незаконченный
 * разбор не выдаётся. Преподаватель скачивает своё в любой момент, включая
 * неопубликованные пометки.
 */
export function canDownloadAttemptPdf(audience: 'staff' | 'student', report: AttemptPdfReport | null): boolean {
  if (!report) return false
  if (audience === 'staff') return true
  return report.decision === 'accepted' || report.decision === 'returned_for_revision'
}

// ---------------------------------------------------------------------------
// Раскладка
// ---------------------------------------------------------------------------

/** Кусок потока: своя высота и умение нарисоваться от заданной высоты. */
interface FlowItem {
  height: number
  draw: (top: number) => ReportDraw[]
}

interface FlowSection {
  /** Заголовок раздела; повторяется на следующем листе с пометкой. */
  title: string | null
  items: FlowItem[]
}

/**
 * §209. Колонки разбора по заданиям. У преподавателя их четыре (номер, итог,
 * ответ ученика, правильный), у ученика — три: своего ответа он не видит.
 * Замечания печатаются отдельными строками ПОД строкой задания, а не пятой
 * колонкой: замечаний на задание бывает несколько, и в колонку шириной с
 * палец они не лезли.
 */
const TASK_COLUMNS_STAFF = [40, 92, 200] as const
const TASK_COLUMNS_STUDENT = [40, 92] as const

function taskColumns(audience: 'staff' | 'student'): { widths: readonly number[]; xs: number[]; last: number } {
  const widths = audience === 'student' ? TASK_COLUMNS_STUDENT : TASK_COLUMNS_STAFF
  const xs: number[] = []
  let x = REPORT_MARGIN
  for (const width of widths) {
    xs.push(x)
    x += width
  }
  xs.push(x)
  return { widths, xs, last: REPORT_CONTENT_WIDTH + REPORT_MARGIN - x }
}

function textBlock(
  text: string,
  options: { size: number; bold?: boolean; color: string; lineHeight: number; gapAfter?: number; x?: number; width?: number },
  measure: TextMeasure,
): FlowItem {
  const width = options.width ?? REPORT_CONTENT_WIDTH
  const x = options.x ?? REPORT_MARGIN
  const lines = wrapText(text, width, options.size, Boolean(options.bold), measure)
  const gapAfter = options.gapAfter ?? 0
  return {
    height: lines.length * options.lineHeight + gapAfter,
    draw: top => lines.map((line, index) => ({
      kind: 'text' as const,
      x,
      y: top + index * options.lineHeight + options.size,
      text: line,
      size: options.size,
      bold: options.bold,
      color: options.color,
    })),
  }
}

function verdictLabel(report: AttemptPdfReport): string | null {
  if (report.decision === 'accepted') return 'Работа принята'
  if (report.decision === 'returned_for_revision') return 'Возвращена на доработку'
  return null
}

function buildHeaderSection(report: AttemptPdfReport, measure: TextMeasure): FlowSection {
  const items: FlowItem[] = []
  items.push(textBlock(report.studentName || 'Ученик', { size: 22, bold: true, color: INK, lineHeight: 28, gapAfter: 6 }, measure))

  const subject = [report.topicTitle, report.homeworkTitle].filter(Boolean).join(' · ')
  if (subject) items.push(textBlock(subject, { size: 13, color: MUTED, lineHeight: 18, gapAfter: 4 }, measure))

  const dates = [
    formatMoment(report.submittedAt) && `Сдано: ${formatMoment(report.submittedAt)}`,
    formatMoment(report.reviewedAt) && `Проверено: ${formatMoment(report.reviewedAt)}`,
  ].filter(Boolean).join('   ·   ')
  if (dates) items.push(textBlock(dates, { size: 11, color: FAINT, lineHeight: 16, gapAfter: 10 }, measure))

  items.push({
    height: 18,
    draw: top => [{ kind: 'line', x: REPORT_MARGIN, y: top + 4, w: REPORT_CONTENT_WIDTH, color: RULE }],
  })

  const label = verdictLabel(report)
  const hasScore = report.score != null
  if (label || hasScore) {
    const tone = report.decision === 'accepted' ? '#047857' : report.decision === 'returned_for_revision' ? '#b45309' : MUTED
    const badge = label ?? 'Проверено'
    const badgeWidth = measure(badge, 13, true) + 24
    const score = hasScore
      ? `Оценка: ${report.score}${report.scoreMax != null ? ` из ${report.scoreMax}` : ''}`
      : null
    items.push({
      height: 42,
      draw: top => {
        const parts: ReportDraw[] = [
          { kind: 'rect', x: REPORT_MARGIN, y: top, w: badgeWidth, h: 28, fill: `${tone}14`, stroke: tone, radius: 8 },
          { kind: 'text', x: REPORT_MARGIN + 12, y: top + 19, text: badge, size: 13, bold: true, color: tone },
        ]
        if (score) {
          parts.push({ kind: 'text', x: REPORT_MARGIN + badgeWidth + 14, y: top + 19, text: score, size: 14, bold: true, color: INK })
        }
        return parts
      },
    })
  }

  return { title: null, items }
}

function buildCommentSection(report: AttemptPdfReport, measure: TextMeasure): FlowSection | null {
  const text = (report.comment ?? '').trim()
  if (!text) return null
  return {
    title: 'Комментарий преподавателя',
    items: [textBlock(text, { size: 13, color: INK, lineHeight: 19, gapAfter: 14 }, measure)],
  }
}

/**
 * §209. Строка задания и ЕГО ЗАМЕЧАНИЯ — вместе, одним неразрывным куском.
 *
 * Замечания берутся оттуда же, откуда их берёт экран: из рамок на работе
 * (плюс легаси-поле `note`). Если бы файл собирал разбор только из колонки
 * `note`, экспорт молча обеднел бы ровно на то, что преподаватель написал
 * после §209, — а заметил бы это ученик, а не мы.
 */
function taskRowItem(
  row: ReviewTaskRow,
  notes: readonly ReviewNote[],
  audience: 'staff' | 'student',
  measure: TextMeasure,
): FlowItem {
  const { widths, xs, last } = taskColumns(audience)
  const answers = audience === 'student'
    ? [expectedOnlyView(row.expected_answer)]
    : (() => {
      const view = answerView(row.student_answer, row.expected_answer)
      return [view.student, view.expected ?? '']
    })()
  const cells = [
    { text: row.no || '—', width: widths[0], bold: true, color: INK },
    { text: REVIEW_TASK_VERDICT_LABEL[row.verdict], width: widths[1], bold: true, color: TASK_TONE[row.verdict] },
    ...(audience === 'student'
      ? [{ text: answers[0], width: last, bold: false, color: INK }]
      : [
        { text: answers[0], width: widths[2], bold: false, color: INK },
        { text: answers[1], width: last, bold: false, color: INK },
      ]),
  ]
  const wrapped = cells.map(cell => wrapText(cell.text, cell.width - 10, 11, cell.bold, measure))
  const headLines = Math.max(...wrapped.map(list => list.length))
  const noteLines = notes.map(note => wrapText(
    note.page != null ? `${note.text} (стр. ${note.page})` : note.text,
    REPORT_CONTENT_WIDTH - 26,
    11,
    false,
    measure,
  ))
  const noteHeight = noteLines.reduce((sum, lines) => sum + lines.length * 14, 0)
  const height = headLines * 15 + 10 + noteHeight + (noteHeight > 0 ? 4 : 0)
  return {
    height,
    draw: top => {
      const parts: ReportDraw[] = [
        { kind: 'line', x: REPORT_MARGIN, y: top + height - 1, w: REPORT_CONTENT_WIDTH, color: RULE },
      ]
      cells.forEach((cell, index) => {
        wrapped[index].forEach((line, lineIndex) => {
          if (!line) return
          parts.push({
            kind: 'text',
            x: xs[index] + 2,
            y: top + 5 + lineIndex * 15 + 11,
            text: line,
            size: 11,
            bold: cell.bold,
            color: cell.color,
          })
        })
      })
      let y = top + headLines * 15 + 8
      noteLines.forEach(lines => {
        lines.forEach(line => {
          parts.push({ kind: 'text', x: REPORT_MARGIN + 24, y: y + 11, text: line, size: 11, bold: false, color: MUTED })
          y += 14
        })
      })
      return parts
    },
  }
}

function taskHead(audience: 'staff' | 'student'): FlowItem {
  return {
    height: 26,
    draw: top => {
      const { xs } = taskColumns(audience)
      const titles = audience === 'student'
        ? ['№', 'Итог', 'Правильный ответ']
        : ['№', 'Вердикт', 'Ответ ученика', 'Правильный ответ']
      const parts: ReportDraw[] = [
        { kind: 'rect', x: REPORT_MARGIN, y: top, w: REPORT_CONTENT_WIDTH, h: 22, fill: '#f1f5f9' },
      ]
      titles.forEach((title, index) => {
        parts.push({ kind: 'text', x: xs[index] + 2, y: top + 15, text: title, size: 10, bold: true, color: MUTED })
      })
      return parts
    },
  }
}

/** Замечания одного задания: рамки на работе плюс легаси-поле `note`. */
export function notesForTaskRow(row: ReviewTaskRow, notes: readonly ReviewNote[]): ReviewNote[] {
  const own = notesOfTask(notes, row.no)
  const legacy = (row.note ?? '').trim()
  if (!legacy) return own
  return [...own, { id: `legacy:${row.id}`, taskNo: row.no, text: legacy, page: null, type: null, categoryLabel: 'Заметка' }]
}

function buildTaskSection(
  report: AttemptPdfReport,
  notes: readonly ReviewNote[],
  measure: TextMeasure,
): FlowSection | null {
  const rows = report.tasks ?? []
  if (rows.length === 0) return null
  const audience = report.audience ?? 'staff'
  return {
    title: 'Разбор по заданиям',
    items: [
      taskHead(audience),
      ...rows.map(row => taskRowItem(row, notesForTaskRow(row, notes), audience, measure)),
      { height: 14, draw: () => [] },
    ],
  }
}

function commentItem(comment: AttemptPdfComment, measure: TextMeasure): FlowItem {
  const textX = REPORT_MARGIN + 34
  const textWidth = REPORT_CONTENT_WIDTH - 34
  const head = `стр. ${comment.globalPage} · ${comment.categoryLabel}`
  const body = wrapText(comment.text || '✓', textWidth, 12, false, measure)
  const height = 16 + body.length * 17 + 10
  return {
    height,
    draw: top => {
      const parts: ReportDraw[] = [
        { kind: 'circle', cx: REPORT_MARGIN + 11, cy: top + 12, r: 11, fill: comment.color },
        { kind: 'text', x: REPORT_MARGIN + 11 - measure(String(comment.number), 11, true) / 2, y: top + 16, text: String(comment.number), size: 11, bold: true, color: '#ffffff' },
        { kind: 'text', x: textX, y: top + 11, text: head, size: 10, bold: false, color: FAINT },
      ]
      body.forEach((line, index) => {
        parts.push({ kind: 'text', x: textX, y: top + 16 + index * 17 + 12, text: line, size: 12, bold: false, color: INK })
      })
      return parts
    },
  }
}

function buildCommentsSection(comments: readonly AttemptPdfComment[], measure: TextMeasure): FlowSection | null {
  if (comments.length === 0) return null
  return {
    title: 'Замечания на страницах работы',
    items: comments.map(comment => commentItem(comment, measure)),
  }
}

function sectionTitleItem(title: string, measure: TextMeasure): FlowItem {
  const block = textBlock(title, { size: 14, bold: true, color: INK, lineHeight: 20, gapAfter: 8 }, measure)
  return { height: block.height + 6, draw: top => block.draw(top + 6) }
}

/**
 * Раскладывает разбор по листам A4.
 *
 * Правило переноса одно и простое: кусок целиком не влез — уходит на
 * следующий лист вместе с заголовком своего раздела (с пометкой
 * «продолжение»), а не режется пополам. Обрезанный на полуслове разбор хуже
 * лишнего листа.
 */
export function buildReportPages(
  report: AttemptPdfReport,
  comments: readonly AttemptPdfComment[],
  measure: TextMeasure,
): ReportDraw[][] {
  // §209. Замечания под заданиями — те же рамки, что нарисованы на страницах
  // работы: один источник, а не два. Список «Замечания на страницах работы»
  // остаётся: в нём нумерация, совпадающая с кружками на страницах, и в него
  // попадают рамки, не привязанные ни к какому заданию.
  const notes: ReviewNote[] = comments.map(comment => ({
    id: String(comment.number),
    taskNo: comment.taskNo ?? null,
    text: comment.text,
    page: comment.globalPage,
    type: null,
    categoryLabel: comment.categoryLabel,
  }))
  const sections = [
    buildHeaderSection(report, measure),
    buildCommentSection(report, measure),
    buildTaskSection(report, notes, measure),
    buildCommentsSection(comments, measure),
  ].filter((section): section is FlowSection => section !== null)

  const bottom = REPORT_PAGE_HEIGHT - REPORT_MARGIN
  const pages: ReportDraw[][] = []
  let current: ReportDraw[] = []
  let y = REPORT_MARGIN

  const newPage = () => {
    pages.push(current)
    current = []
    y = REPORT_MARGIN
  }

  for (const section of sections) {
    let titleDrawn = false
    const drawTitle = (continued: boolean) => {
      if (!section.title) return
      const item = sectionTitleItem(continued ? `${section.title} (продолжение)` : section.title, measure)
      current.push(...item.draw(y))
      y += item.height
    }
    for (const item of section.items) {
      if (!titleDrawn) {
        const title = section.title ? sectionTitleItem(section.title, measure) : null
        // Заголовок не остаётся один внизу листа: он уезжает вместе с первой
        // строкой раздела.
        if (y + (title?.height ?? 0) + item.height > bottom && current.length > 0) newPage()
        drawTitle(false)
        titleDrawn = true
      } else if (y + item.height > bottom && current.length > 0) {
        newPage()
        drawTitle(true)
      }
      current.push(...item.draw(y))
      y += item.height
    }
  }

  pages.push(current)
  return pages
}
