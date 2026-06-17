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

// ─── Домашние задания ─────────────────────────────────────────────
export interface HomeworkExportRow {
  studentName: string
  groupName:   string
  hwTitle:     string
  status:      string
  score:       number | null
  maxScore:    number
  submittedAt: string
  checkedAt:   string
}

export function exportHomeworks(rows: HomeworkExportRow[]) {
  const STATUS: Record<string, string> = {
    pending:    'Не сдано',
    submitted:  'Сдано',
    checked:    'Проверено',
    revision:   'На доработку',
  }

  const data = rows.map(r => ({
    'Ученик':          r.studentName,
    'Группа':          r.groupName,
    'ДЗ':              r.hwTitle,
    'Статус':          STATUS[r.status] || r.status,
    'Балл':            r.score ?? '',
    'Макс. балл':      r.maxScore,
    'Дата сдачи':      r.submittedAt,
    'Дата проверки':   r.checkedAt,
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  setColWidths(ws, [30, 20, 35, 15, 8, 12, 18, 18])

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Домашние задания')
  download(wb, 'domashnie_zadania.xlsx')
}

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
  feedback:   string
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
    'Комментарий':     r.feedback,
  }))

  const ws = XLSX.utils.json_to_sheet(data)
  setColWidths(ws, [30, 14, 16, 20, 30, 8, 12, 14, 35])

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
