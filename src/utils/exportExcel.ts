import * as XLSX from 'xlsx'

/** Скачивает файл в браузере */
function download(wb: XLSX.WorkBook, fileName: string) {
  XLSX.writeFile(wb, fileName)
}

// ─── Посещаемость ────────────────────────────────────────────────
export interface AttendanceExportRow {
  studentName: string
  groupName:   string
  present:     number
  late:        number
  absent:      number
  total:       number
  pct:         number
}

export function exportAttendance(rows: AttendanceExportRow[], groupName?: string) {
  const data = rows.map(r => ({
    'Ученик':          r.studentName,
    'Группа':          r.groupName,
    'Присутствовал':   r.present,
    'Опоздал':         r.late,
    'Отсутствовал':    r.absent,
    'Всего занятий':   r.total,
    'Посещаемость, %': r.pct,
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  setColWidths(ws, [30, 20, 16, 12, 16, 16, 18])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Посещаемость')
  download(wb, `poseschaemost${groupName ? '_' + groupName : ''}.xlsx`)
}

// Выгрузка «Домашние задания» (`exportHomeworks` + `HomeworkExportRow`) снята
// в §185: со времени удаления `HomeworksPage` (§170) её никто не вызывал, а
// строки она собирала из `homeworks`/`homework_submissions` — старого контура
// ДЗ, где 0 строк. Живой контур выгружается не отсюда.

// ─── Пробники ─────────────────────────────────────────────────────
export interface MockExamExportRow {
  examTitle:  string
  examDate:   string
  subject:    string
  groupName:  string
  studentName: string
  score:      number
  maxScore:   number
  pct:        number
  /** §215. Части пробника; null — деления у этого пробника нет. */
  part1:      number | null
  part2:      number | null
  /** §215. Колонка `notes` таблицы; прежнего `feedback` в базе не было. */
  notes:      string
  /** §218. Первичный балл (у пробника с шаблоном); null — у старых пробников его нет. */
  primary?:   number | null
  /** §218. Баллы по заданиям: tasks[0] — №1. null — клетка пустая (нет данных), не ноль. */
  tasks?:     (number | null)[]
}

export function exportMockExams(rows: MockExamExportRow[]) {
  const data = rows.map(r => ({
    'Пробник':         r.examTitle,
    'Дата':            r.examDate,
    'Предмет':         r.subject,
    'Группа':          r.groupName,
    'Ученик':          r.studentName,
    'Балл':            r.score,
    'Макс. балл':      r.maxScore,
    'Результат, %':    r.pct,
    // §215. Части — из тех же колонок, что теперь заполняет модалка; без них
    // выгрузка противоречила бы тому, что преподаватель только что ввёл.
    '1 часть':         r.part1 ?? '',
    '2 часть':         r.part2 ?? '',
    'Заметка':         r.notes,
    // §218. Первичный и баллы по номерам — ради них пробник и вводится по
    // заданиям. Пустая клетка остаётся пустой: «нет данных» ≠ 0.
    ...(r.tasks ? { 'Первичный': r.primary ?? '' } : {}),
    ...Object.fromEntries((r.tasks ?? []).map((v, t) => [`№${t + 1}`, v ?? ''])),
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  setColWidths(ws, [30, 14, 16, 20, 30, 8, 12, 14, 10, 10, 35])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Пробники')
  download(wb, 'probniki.xlsx')
}

// ─── Платежи ─────────────────────────────────────────────────────────────────
export interface PaymentExportRow {
  date:        string
  description: string
  student:     string
  amount:      number
  currency:    string
  status:      string
  recurring:   string
}

export function exportPayments(rows: PaymentExportRow[]) {
  const data = rows.map(r => ({
    'Дата':     r.date,
    'Описание': r.description,
    'Ученик':   r.student,
    'Сумма':    r.amount,
    'Валюта':   r.currency,
    'Статус':   r.status,
    'Авто':     r.recurring,
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  setColWidths(ws, [18, 35, 28, 12, 8, 14, 8])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Платежи')
  download(wb, 'platezhi.xlsx')
}

// ─── helpers ─────────────────────────────────────────────────────
function setColWidths(ws: XLSX.WorkSheet, widths: number[]) {
  ws['!cols'] = widths.map(w => ({ wch: w }))
}
