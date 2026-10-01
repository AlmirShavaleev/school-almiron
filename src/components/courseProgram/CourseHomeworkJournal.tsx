import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Download, Loader2 } from 'lucide-react'
import { cn } from '@/utils/cn'
import { GRADE_CLS } from './CourseAssessmentsTab'
import {
  homeworkJournalSheet, homeworkJournalView, journalMetaText,
  type CourseHomeworkGrades, type HwCellView, type HwJournalView, type HwSortMode, type SectionSummary,
} from '@/lib/courseHomeworkJournal'
import type { LoadStatus } from '@/hooks/useCourseAssessments'

/**
 * §250. Журнал домашних заданий — основной вид вкладки «Домашние задания»
 * (макет владельца 01.10): строки — ученики, столбцы — разделы курса; нажатие
 * на раздел раскрывает ДЗ его тем. Образец — журнал «Проверочные и
 * контрольные» (§249): липкая колонка имён, прокрутка вбок ВНУТРИ таблицы,
 * те же цвета оценок, нажатие на клетку — строка с переходом к работе ученика
 * (`/homework-queue?attempt=`), выгрузка в Excel (модуль грузится по нажатию).
 * Правила клеток и раздела — `lib/courseHomeworkJournal.ts`.
 */
export function CourseHomeworkJournal({ status, data, groupName, onShowTopics }: {
  status: LoadStatus
  data: CourseHomeworkGrades | null
  groupName: string | null
  onShowTopics: () => void
}) {
  const [sort, setSort] = useState<HwSortMode>('name')
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set())
  const [picked, setPicked] = useState<{ topicId: string; studentId: string } | null>(null)
  const view = useMemo(() => (data ? homeworkJournalView(data, { sort }) : null), [data, sort])

  const shell = (children: ReactNode, meta?: string) => (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-labelledby="hw-journal-title" data-testid="hw-journal">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4">
        <h2 id="hw-journal-title" className="text-base font-extrabold text-graphite-900">Домашние задания по ученикам</h2>
        {meta && <span className="text-[13px] text-graphite-600" data-testid="hw-journal-meta">{meta}</span>}
      </div>
      {children}
    </section>
  )
  const note = (text: ReactNode, testId: string) => <p className="px-4 pb-4 pt-2 text-sm text-graphite-600" data-testid={testId}>{text}</p>

  if (!data || !view) {
    return shell(status === 'error'
      ? note(<>Таблица сейчас недоступна — обновите страницу чуть позже. Пока работы видны{' '}
          <button type="button" onClick={onShowTopics} className="font-bold text-primary-700 underline-offset-2 hover:underline">по темам</button>.</>, 'hw-journal-error')
      : <p className="flex items-center gap-2 px-4 pb-4 pt-2 text-sm text-graphite-500"><Loader2 size={16} className="animate-spin" aria-hidden />Загрузка домашних заданий…</p>)
  }
  if (data.students.length === 0) return shell(note('В классе пока нет учеников.', 'hw-journal-empty'))
  if (view.sections.length === 0) {
    return shell(note('Выданных домашних заданий пока нет: задание появится здесь, когда откроется тема с опубликованным ДЗ.', 'hw-journal-empty'))
  }

  const toggle = (moduleId: string) => setOpenSections(prev => {
    const next = new Set(prev)
    if (next.has(moduleId)) next.delete(moduleId)
    else next.add(moduleId)
    return next
  })

  const download = async () => {
    const { exportHomeworkJournal } = await import('@/utils/exportExcel')
    exportHomeworkJournal(homeworkJournalSheet(view), groupName)
  }

  const pickedDetail = (() => {
    if (!picked) return null
    const row = view.rows.find(r => r.student.student_id === picked.studentId)
    for (let si = 0; si < view.sections.length; si += 1) {
      const ci = view.sections[si].columns.findIndex(c => c.hw.topic_id === picked.topicId)
      if (ci >= 0 && row) return { name: row.student.name, title: view.sections[si].columns[ci].hw.topic_title, cell: row.sections[si].cells[ci] }
    }
    return null
  })()

  return shell(
    <>
      <Legend />
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
        <span className="text-[13px] text-graphite-600">Нажмите на раздел — раскроются ДЗ его тем.</span>
        <span className="hidden flex-1 sm:block" />
        <button
          type="button"
          aria-pressed={sort === 'behind'}
          onClick={() => setSort(s => (s === 'behind' ? 'name' : 'behind'))}
          data-testid="hw-sort-behind"
          className={cn(
            'inline-flex min-h-11 items-center rounded-lg border px-3 text-[13px] font-bold md:min-h-9',
            sort === 'behind' ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-200 bg-white text-graphite-800 hover:border-primary-200',
          )}
        >
          Сначала отстающие
        </button>
        <button
          type="button"
          onClick={() => { void download() }}
          data-testid="hw-export"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-bold text-graphite-800 hover:border-primary-200 md:min-h-9"
        >
          <Download size={14} aria-hidden />Скачать (Excel)
        </button>
      </div>

      {pickedDetail && pickedDetail.cell.kind !== 'empty' && (
        <CellDetail name={pickedDetail.name} title={pickedDetail.title} cell={pickedDetail.cell} />
      )}

      <JournalTable view={view} open={openSections} onToggle={toggle} picked={picked} onPick={(topicId, studentId) => setPicked({ topicId, studentId })} />
      <p className="px-4 pb-4 pt-2.5 text-[13px] text-graphite-600">
        В клетке раздела — сколько ДЗ принято из выданных; красным — есть просроченные. Нажатие на клетку ДЗ открывает
        работу ученика.
      </p>
    </>,
    journalMetaText(view),
  )
}

// ─── Цвета и легенда ────────────────────────────────────────────────────────

const OK_CLS = 'bg-[#e3f4e8] text-[#15803d]'
const WAIT_CLS = 'bg-[#f0eafd] text-[#6d28d9]'
const RET_CLS = 'bg-[#fdf1e2] text-[#b45309]'
const LATE_CLS = 'bg-[#fde6dc] text-[#c2410c]'
const CELL_BASE = 'inline-grid h-7 min-w-10 place-items-center rounded-lg px-1.5 font-extrabold'

function Legend() {
  const sw = (cls: string, text: string) => <span className={cn(CELL_BASE, cls, 'h-6 min-w-8 text-[11px]')} aria-hidden>{text}</span>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 px-4 pb-2.5 pt-3 text-[12px] text-graphite-600" data-testid="hw-legend">
      <span className="inline-flex items-center gap-1.5">{sw(OK_CLS, '✓')}принято</span>
      <span className="inline-flex items-center gap-1.5">{sw(GRADE_CLS[4], '4')}оценка (если у ДЗ есть шкала)</span>
      <span className="inline-flex items-center gap-1.5">{sw(WAIT_CLS, 'ждёт')}сдано, не проверено</span>
      <span className="inline-flex items-center gap-1.5">{sw(RET_CLS, 'дораб.')}вернули</span>
      <span className="inline-flex items-center gap-1.5">{sw(LATE_CLS, 'просроч.')}срок прошёл, не сдано</span>
      <span>— срок не наступил</span>
    </div>
  )
}

function CellDetail({ name, title, cell }: { name: string; title: string; cell: Exclude<HwCellView, { kind: 'empty' }> }) {
  const text = cell.kind === 'wait' ? 'сдал, ждёт проверки'
    : cell.kind === 'returned' ? 'возвращено на доработку'
      : cell.kind === 'late' ? (cell.attemptId ? 'срок прошёл, работа не сдана (есть черновик)' : 'срок прошёл, работа не сдана')
        : cell.kind === 'accepted' ? 'принято'
          : <>оценка <b className="font-extrabold">{cell.text}</b></>
  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm" data-testid="hw-detail" aria-live="polite">
      <span><b className="font-extrabold">{name}</b> · {title}</span>
      <span>{text}</span>
      <span className="flex-1" />
      {cell.attemptId && cell.kind !== 'late' && (
        <Link
          to={`/homework-queue?attempt=${cell.attemptId}`}
          data-testid="hw-detail-open"
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-primary-50 px-3 text-[13px] font-bold text-primary-700 hover:bg-primary-100 md:min-h-9"
        >
          {cell.kind === 'wait' ? 'Проверить' : 'Открыть работу'}
        </Link>
      )}
    </div>
  )
}

// ─── Таблица ────────────────────────────────────────────────────────────────

const NAME_CELL = 'sticky left-0 z-[1] border-r border-gray-200 px-3 text-left'
const SUM_TONE: Record<SectionSummary['tone'], string> = {
  bad: 'text-[#c2410c]',
  ok: 'text-[#15803d]',
  plain: 'text-graphite-900',
}

function JournalTable({ view, open, onToggle, picked, onPick }: {
  view: HwJournalView
  open: ReadonlySet<string>
  onToggle: (moduleId: string) => void
  picked: { topicId: string; studentId: string } | null
  onPick: (topicId: string, studentId: string) => void
}) {
  return (
    <div className="overflow-x-auto border-t border-gray-200" data-testid="hw-scroll">
      <table className="w-full min-w-max border-separate border-spacing-0 tabular-nums" data-testid="hw-table">
        <thead>
          <tr>
            <th scope="col" className={cn(NAME_CELL, 'border-b bg-white py-2 align-bottom text-xs font-bold text-graphite-600')}>Ученик</th>
            {view.sections.map(s => {
              const isOpen = open.has(s.moduleId)
              const n = s.columns.length
              return (
                <Fragment key={s.moduleId}>
                  <th scope="col" className="min-w-[96px] border-b border-gray-200 bg-white px-1.5 py-2 align-bottom" data-testid="hw-section-col">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => onToggle(s.moduleId)}
                      data-testid="hw-section-toggle"
                      title={s.title}
                      className={cn(
                        'w-full max-w-[128px] rounded-lg border px-1.5 py-1 text-[11.5px] font-extrabold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400',
                        isOpen ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-graphite-800 hover:border-primary-300',
                      )}
                    >
                      <span className="line-clamp-2 break-words">{s.title}</span>
                      <span className="mt-0.5 block font-semibold text-graphite-500">{n} ДЗ {isOpen ? '▾' : '▸'}</span>
                    </button>
                  </th>
                  {isOpen && s.columns.map(c => (
                    <th key={c.hw.topic_id} scope="col" className="w-[104px] max-w-[104px] border-b border-gray-200 bg-primary-50 px-1.5 py-2 align-bottom text-center text-[11px] font-bold leading-tight text-graphite-800" data-testid="hw-col" title={c.hw.topic_title}>
                      <span className="line-clamp-3 break-words">{c.hw.topic_title}</span>
                      <span className="mt-0.5 block font-semibold text-graphite-400">{c.dueLabel}</span>
                    </th>
                  ))}
                </Fragment>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, ri) => {
            const zebra = ri % 2 === 1 ? 'bg-slate-50' : 'bg-white'
            return (
              <tr key={r.student.student_id} data-testid="hw-row">
                <th scope="row" className={cn(NAME_CELL, zebra, 'min-w-[150px] whitespace-nowrap border-b py-0 text-[14px] font-semibold text-graphite-900 sm:min-w-[180px]')}>
                  <span data-testid="hw-name">{r.student.name}</span>
                </th>
                {view.sections.map((s, si) => {
                  const part = r.sections[si]
                  return (
                    <Fragment key={s.moduleId}>
                      <td className={cn(zebra, 'border-b border-gray-200 px-1.5 py-1 text-center')} data-testid="hw-sum" data-tone={part.summary.tone}>
                        <span className={cn('block text-[12.5px] font-extrabold', SUM_TONE[part.summary.tone])}>{part.summary.text}</span>
                        <span className={cn('block text-[11px] font-semibold', part.summary.late > 0 ? 'text-[#c2410c]' : 'text-graphite-400')}>
                          {part.summary.note || ' '}
                        </span>
                      </td>
                      {open.has(s.moduleId) && part.cells.map((c, ci) => {
                        const col = s.columns[ci]
                        const on = picked?.topicId === col.hw.topic_id && picked.studentId === r.student.student_id
                        return (
                          <td key={col.hw.topic_id} className={cn('border-b border-gray-200 bg-primary-50/40 px-1.5 py-1 text-center')}>
                            <HwCellButton cell={c} on={on} label={`${r.student.name}, ${col.hw.topic_title}`} onClick={() => onPick(col.hw.topic_id, r.student.student_id)} />
                          </td>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const SPOKEN: Record<HwCellView['kind'], string> = {
  accepted: 'принято', grade: '', wait: 'ждёт проверки', returned: 'на доработке', late: 'просрочено', empty: 'не сдавал',
}

function HwCellButton({ cell, on, label, onClick }: { cell: HwCellView; on: boolean; label: string; onClick: () => void }) {
  if (cell.kind === 'empty' || (cell.kind === 'late' && !cell.attemptId)) {
    return (
      <span
        className={cn(CELL_BASE, cell.kind === 'late' ? cn(LATE_CLS, 'text-[10.5px]') : 'font-semibold text-graphite-400')}
        data-testid="hw-cell"
        data-state={cell.kind}
        aria-label={`${label}: ${SPOKEN[cell.kind]}`}
      >
        {cell.text}
      </span>
    )
  }
  const cls = cell.kind === 'grade'
    ? (cell.tone ? GRADE_CLS[cell.tone] : 'bg-slate-100 text-graphite-700')
    : cell.kind === 'accepted' ? OK_CLS
      : cell.kind === 'wait' ? WAIT_CLS
        : cell.kind === 'returned' ? RET_CLS
          : LATE_CLS
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={`${label}: ${cell.kind === 'grade' ? `оценка ${cell.text}` : SPOKEN[cell.kind]}`}
      data-testid="hw-cell"
      data-state={cell.kind}
      className={cn(
        CELL_BASE, cls,
        cell.kind === 'grade' || cell.kind === 'accepted' ? 'text-[14px]' : 'text-[10.5px]',
        'hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-primary-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-500',
        on && 'outline outline-2 outline-offset-1 outline-primary-600',
      )}
    >
      {cell.text}
    </button>
  )
}
