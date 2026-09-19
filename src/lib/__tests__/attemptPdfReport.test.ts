/**
 * §206. Разбор на последней странице PDF: что печатается, чего не печатается
 * и что происходит, когда не влезает.
 *
 * Раскладка считается без canvas — в vitest он заглушка, — поэтому ширину
 * текста подставляет простая мерка «полразмера на букву». Она условна, но
 * монотонна, а проверяются здесь решения раскладки, а не форма букв.
 */
import { describe, expect, it } from 'vitest'
import {
  REPORT_PAGE_HEIGHT,
  attemptPdfFileName,
  buildReportPages,
  canDownloadAttemptPdf,
  shortStudentName,
  wrapText,
  type AttemptPdfComment,
  type AttemptPdfReport,
  type ReportDraw,
} from '../attemptPdfReport'
import type { ReviewTaskRow } from '../homeworkReviewTasks'

const measure = (text: string, size: number) => text.length * size * 0.5

const BASE: AttemptPdfReport = {
  studentName: 'Иванов Иван Петрович',
  homeworkTitle: 'ДЗ №3',
  topicTitle: 'Квадратные уравнения',
  submittedAt: '2026-09-18T12:00:00.000Z',
  reviewedAt: '2026-09-19T07:00:00.000Z',
  decision: 'accepted',
  score: 4,
  scoreMax: 5,
  comment: null,
  tasks: [],
}

function task(no: string, partial?: Partial<ReviewTaskRow>): ReviewTaskRow {
  return {
    id: `t-${no}`,
    attempt_id: 'att-1',
    no,
    verdict: 'correct',
    student_answer: '12',
    expected_answer: '12',
    note: null,
    position: Number(no),
    updated_by: null,
    updated_at: '2026-09-19T07:00:00.000Z',
    ...partial,
  }
}

function comment(number: number, text: string): AttemptPdfComment {
  return { number, globalPage: number, categoryLabel: 'Вычислительная ошибка', color: '#dc2626', text }
}

const textsOf = (pages: ReportDraw[][]) =>
  pages.map(items => items.filter(item => item.kind === 'text').map(item => (item as { text: string }).text))

const allText = (pages: ReportDraw[][]) => textsOf(pages).flat().join('\n')

describe('buildReportPages', () => {
  it('шапка: имя, тема с названием ДЗ, обе даты, вердикт и балл', () => {
    const pages = buildReportPages(BASE, [], measure)
    const text = allText(pages)
    expect(pages).toHaveLength(1)
    expect(text).toContain('Иванов Иван Петрович')
    expect(text).toContain('Квадратные уравнения · ДЗ №3')
    expect(text).toContain('Сдано:')
    expect(text).toContain('Проверено:')
    expect(text).toContain('Работа принята')
    expect(text).toContain('Оценка: 4 из 5')
  })

  it('нет таблицы и нет замечаний — нет и заголовков этих разделов', () => {
    const text = allText(buildReportPages(BASE, [], measure))
    expect(text).not.toContain('Разбор по заданиям')
    expect(text).not.toContain('Замечания на страницах')
    expect(text).not.toContain('Комментарий преподавателя')
  })

  it('пустой комментарий из пробелов — тоже не раздел', () => {
    const text = allText(buildReportPages({ ...BASE, comment: '   \n  ' }, [], measure))
    expect(text).not.toContain('Комментарий преподавателя')
  })

  it('таблица по заданиям печатается со всеми колонками и строками', () => {
    const pages = buildReportPages(
      { ...BASE, tasks: [task('1'), task('2', { verdict: 'wrong', student_answer: '7', expected_answer: '9', note: 'знак' })] },
      [],
      measure,
    )
    const text = allText(pages)
    expect(text).toContain('Разбор по заданиям')
    expect(text).toContain('Ответ ученика')
    expect(text).toContain('Правильный ответ')
    expect(text).toContain('неверно')
    // §209. Заметка печатается строкой ПОД заданием, а не пятой колонкой:
    // замечаний на задание бывает несколько, и в колонку они не лезли.
    expect(text).toContain('знак')
  })

  it('номера замечаний — те же, что в кружках на страницах работы', () => {
    const pages = buildReportPages(BASE, [comment(1, 'Проверь знак'), comment(2, 'Нет единиц')], measure)
    const text = allText(pages)
    expect(text).toContain('Замечания на страницах работы')
    expect(text).toContain('1')
    expect(text).toContain('2')
    expect(text).toContain('стр. 1 · Вычислительная ошибка')
    expect(text).toContain('Проверь знак')
  })

  it('длинный разбор продолжается на следующей странице, а не обрезается', () => {
    const comments = Array.from({ length: 40 }, (_v, index) => comment(index + 1, `Замечание номер ${index + 1}`))
    const pages = buildReportPages(BASE, comments, measure)

    expect(pages.length).toBeGreaterThan(1)
    const text = allText(pages)
    // Ни одно замечание не потерялось.
    for (const item of comments) expect(text).toContain(item.text)
    // На втором листе заголовок раздела повторён с пометкой.
    expect(textsOf(pages)[1].join('\n')).toContain('Замечания на страницах работы (продолжение)')
  })

  it('ничего не вылезает за нижний край листа', () => {
    const comments = Array.from({ length: 25 }, (_v, index) => comment(index + 1, 'Короткое замечание'))
    const pages = buildReportPages({ ...BASE, tasks: Array.from({ length: 20 }, (_v, i) => task(String(i + 1))) }, comments, measure)
    for (const items of pages) {
      for (const item of items) {
        const bottom = item.kind === 'text' ? item.y
          : item.kind === 'rect' ? item.y + item.h
          : item.kind === 'circle' ? item.cy + item.r
          : item.y
        expect(bottom).toBeLessThanOrEqual(REPORT_PAGE_HEIGHT)
      }
    }
  })
})

describe('wrapText', () => {
  it('переносит по словам и режет слово, которое не влезает целиком', () => {
    expect(wrapText('раз два три', 30, 10, false, measure)).toEqual(['раз', 'два', 'три'])
    const long = wrapText('абвгдеёжзийклмноп', 30, 10, false, measure)
    expect(long.length).toBeGreaterThan(1)
    expect(long.join('')).toBe('абвгдеёжзийклмноп')
  })
})

describe('имя файла и правило показа кнопки', () => {
  it('«Фамилия И.» и дата сдачи', () => {
    expect(shortStudentName('Иванов Иван Петрович')).toBe('Иванов И.')
    expect(shortStudentName('Иванов')).toBe('Иванов')
    expect(shortStudentName('  ')).toBe('Ученик')
    expect(attemptPdfFileName('Иванов Иван Петрович', '2026-09-18T12:00:00.000Z'))
      .toBe('Работа — Иванов И. — 18.09.2026.pdf')
  })

  it('косая черта в имени не ломает имя файла', () => {
    expect(attemptPdfFileName('Ким/Ли Анна', '2026-09-18T12:00:00.000Z'))
      .toBe('Работа — Ким-Ли А. — 18.09.2026.pdf')
  })

  it('ученику — только после вердикта, преподавателю — всегда', () => {
    const draft: AttemptPdfReport = { ...BASE, decision: null }
    expect(canDownloadAttemptPdf('student', draft)).toBe(false)
    expect(canDownloadAttemptPdf('student', { ...BASE, decision: 'accepted' })).toBe(true)
    expect(canDownloadAttemptPdf('student', { ...BASE, decision: 'returned_for_revision' })).toBe(true)
    expect(canDownloadAttemptPdf('staff', draft)).toBe(true)
    expect(canDownloadAttemptPdf('staff', null)).toBe(false)
  })
})

/**
 * §209. Последняя страница файла обязана показывать ТЕ ЖЕ замечания, что
 * экран, и под теми же заданиями. Иначе экспорт молча беднеет ровно на то,
 * что преподаватель написал после §209, — а заметит это ученик, а не мы.
 */
describe('§209 — замечания в разборе PDF', () => {
  const bound = (number: number, text: string, taskNo: string): AttemptPdfComment => ({
    number, globalPage: 2, categoryLabel: 'Ошибка', color: '#dc2626', text, taskNo,
  })

  it('замечание-рамка печатается под своим заданием', () => {
    const pages = buildReportPages(
      { ...BASE, tasks: [task('13', { verdict: 'wrong', student_answer: '12', expected_answer: '30' })] },
      [bound(1, 'Ошибка в отборе корней', '13')],
      measure,
    )
    const text = allText(pages)
    expect(text).toContain('Разбор по заданиям')
    expect(text).toContain('Ошибка в отборе корней')
  })

  it('старое поле note печатается вместе с рамками — оно тоже замечание', () => {
    const pages = buildReportPages(
      { ...BASE, tasks: [task('13', { note: 'старая заметка' })] },
      [bound(1, 'Новое замечание', '13')],
      measure,
    )
    const text = allText(pages)
    expect(text).toContain('старая заметка')
    expect(text).toContain('Новое замечание')
  })

  it('ученику печатается правильный ответ, но НЕ его собственный', () => {
    const pages = buildReportPages(
      {
        ...BASE,
        audience: 'student',
        tasks: [task('13', { verdict: 'wrong', student_answer: '0,375', expected_answer: '30' })],
      },
      [],
      measure,
    )
    const text = allText(pages)
    expect(text).toContain('Правильный ответ')
    expect(text).not.toContain('Ответ ученика')
    expect(text).not.toContain('0,375')
    expect(text).toContain('30')
  })

  it('преподаватель скачивает своё целиком — ответ ученика на месте', () => {
    const pages = buildReportPages(
      { ...BASE, tasks: [task('13', { verdict: 'wrong', student_answer: '0,375', expected_answer: '30' })] },
      [],
      measure,
    )
    const text = allText(pages)
    expect(text).toContain('Ответ ученика')
    expect(text).toContain('0,375')
  })
})
