import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/format'
import { useMockExamGrid } from '@/hooks/useMockExamGrid'
import { plural } from '@/lib/plural'
import {
  applyPaste,
  averageTotals,
  emptyGrid,
  gridErrors,
  gridFromPoints,
  gridToPoints,
  normName,
  parseCell,
  rowTotals,
  taskStats,
  type Grid,
  type PasteReport,
} from '@/lib/mockExamGrid'

/**
 * §218. Пробник по номерам заданий — таблица как в Excel.
 *
 * Поведение и композиция — по утверждённому макету (`МАКЕТ-ПРОБНИКА.html`), логика —
 * из него же, вынесена в `lib/mockExamGrid` под тесты. Здесь только показ,
 * клавиатура и события вставки. Цвета — проектные (Tailwind), не макета.
 *
 * Три правила, ради которых экран устроен именно так:
 *  1. баллы не уезжают не тому ученику: кого не узнали по фамилии — список
 *     под таблицей, и его строка не вставлена никуда;
 *  2. сохранение — всё или ничего: хоть одна красная клетка — не пишем
 *     ничего, в базе задания и итоги пишутся одной транзакцией;
 *  3. уведомление ученику — только если его итог появился или изменился.
 */

const HEAT = [
  'bg-red-100 text-red-800',
  'bg-amber-100 text-amber-900',
  'bg-lime-100 text-lime-900',
  'bg-emerald-100 text-emerald-900',
] as const

const cellId = (s: number, t: number) => `mx-c-${s}-${t}`

/**
 * Итоги справа «заморожены», как закреплённые столбцы Excel: при 19 заданиях
 * таблица на 1280 с боковым меню не помещается, и без этого итоги уезжали за
 * край. На телефоне не замораживаем — четыре итога заняли бы весь экран.
 * Ширина фиксированная, иначе смещения `right` не сходятся.
 */
const TOT_W = 'w-[66px] min-w-[66px] max-w-[66px] overflow-hidden'
const TOT_STICKY = ['sm:sticky sm:right-[198px]', 'sm:sticky sm:right-[132px]', 'sm:sticky sm:right-[66px]', 'sm:sticky sm:right-0'] as const

export function MockExamGridPage() {
  const { id } = useParams<{ id: string }>()
  const { exam, students, points, loading, error, save } = useMockExamGrid(id)
  const template = exam?.template ?? null
  const maxPts = template?.max_points ?? []
  const p1End = template?.part1_last ?? 0
  const roster = useMemo(() => students.map(s => s.name), [students])

  // Таблица = сохранённое, пока человек ничего не тронул; после первой правки
  // — своя копия. Считается синхронно, а не эффектом: иначе между появлением
  // клеток и заполнением таблицы был бы кадр, в который вставка из буфера
  // легла бы в пустую таблицу.
  const saved = useMemo<Grid>(() => {
    if (!template) return []
    return points.length ? gridFromPoints(points, template.max_points) : emptyGrid(students.length, template.max_points.length)
  }, [points, students.length, template])
  const [edited, setGrid] = useState<Grid | null>(null)
  const grid = edited ?? saved
  const [undo, setUndo] = useState<Grid | null>(null)
  const [report, setReport] = useState<PasteReport | { mode: 'cleared' } | null>(null)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const totals = useMemo(() => grid.map(r => rowTotals(r, maxPts, p1End, template?.score_scale)), [grid, maxPts, p1End, template])
  const stats = useMemo(() => taskStats(grid, maxPts), [grid, maxPts])
  const avg = useMemo(() => averageTotals(totals), [totals])
  const maxPrimary = maxPts.reduce((a, b) => a + b, 0)
  const dirty = useMemo(() => JSON.stringify(gridToPoints(grid)) !== JSON.stringify(points) || gridErrors(grid).length > 0, [grid, points])

  // Ссылка на актуальную таблицу для обработчика вставки на документе.
  const gridRef = useRef(grid)
  gridRef.current = grid

  function edit(s: number, t: number, value: string) {
    setGrid(prev => {
      const next = (prev ?? saved).map(r => r.slice())
      next[s][t] = parseCell(value, maxPts[t])
      return next
    })
    setStatus(null)
  }

  function doPaste(text: string, at: { s: number; t: number } | null): boolean {
    const res = applyPaste(gridRef.current, text, at, roster, maxPts)
    if (!res) return false
    setUndo(gridRef.current)
    setGrid(res.grid)
    setReport(res.report)
    setStatus(null)
    return true
  }

  function onCellPaste(e: ClipboardEvent<HTMLElement>, at: { s: number; t: number }, intoInput: boolean) {
    const text = e.clipboardData?.getData('text') ?? ''
    if (!text) return
    // Одно число без табов и переводов строк в клетку ввода — обычный ввод,
    // пусть браузер вставит его сам.
    if (intoInput && !/[\t\n]/.test(text.trim()) && !/[^\d\s.,]/.test(text)) return
    e.preventDefault()
    doPaste(text, at)
  }

  // Макет: запасной путь — вставка, пока фокус не в поле ввода (например,
  // после щелчка по заголовку), идёт как вставка блока с фамилиями.
  useEffect(() => {
    function onDocPaste(e: globalThis.ClipboardEvent) {
      if (e.defaultPrevented) return
      const a = document.activeElement
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return
      const text = e.clipboardData?.getData('text') ?? ''
      if (!text || !template) return
      if (doPaste(text, null)) e.preventDefault()
    }
    document.addEventListener('paste', onDocPaste)
    return () => document.removeEventListener('paste', onDocPaste)
  })

  function onKey(e: KeyboardEvent<HTMLInputElement>, s: number, t: number) {
    const el = e.currentTarget
    let ns = s, nt = t
    if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) nt++
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) nt--
    else if (e.key === 'ArrowDown' || e.key === 'Enter') ns++
    else if (e.key === 'ArrowUp') ns--
    else return
    if (ns < 0 || ns >= roster.length || nt < 0 || nt >= maxPts.length) return
    e.preventDefault()
    document.getElementById(cellId(ns, nt))?.focus()
  }

  function undoPaste() {
    if (!undo) return
    setGrid(undo)
    setUndo(null)
    setReport(null)
  }

  function clearAll() {
    setUndo(grid)
    setGrid(emptyGrid(roster.length, maxPts.length))
    setReport({ mode: 'cleared' })
    setStatus(null)
  }

  async function onSave() {
    const bad = gridErrors(grid)
    if (bad.length) {
      const where = bad.slice(0, 4).map(b => `${roster[b.s]}, №${b.t + 1}`).join('; ')
      setStatus({
        kind: 'error',
        text: `Не сохранено ничего: ${bad.length} ${plural(bad.length, 'клетка обведена', 'клетки обведены', 'клеток обведены')} красным (${where}${bad.length > 4 ? '…' : ''}). Исправьте — сохранять половину не будем.`,
      })
      return
    }
    setSaving(true)
    const { error: err, notified } = await save(gridToPoints(grid))
    setSaving(false)
    if (err) { setStatus({ kind: 'error', text: `Не сохранено: ${err}` }); return }
    setUndo(null)
    setReport(null)
    setGrid(null)
    setStatus({ kind: 'ok', text: notified ? `Сохранено. Уведомлено учеников: ${notified} — у них итог появился или изменился.` : 'Сохранено. Итоги ни у кого не изменились — уведомлений нет.' })
  }

  if (loading) {
    return <div className="flex h-64 items-center justify-center gap-2 text-gray-400"><Loader2 size={18} className="animate-spin" />Загрузка…</div>
  }
  if (error || !exam) {
    return <Notice title="Пробник не открылся">{error || 'Пробник не найден'}</Notice>
  }
  if (!exam.group_id) {
    return <Notice title={exam.title}>У пробника нет группы — результаты не ввести. Список учеников берётся из группы, а у этого пробника она не указана.</Notice>
  }
  if (!template) {
    return <Notice title={exam.title}>У пробника нет шаблона — баллы по номерам заданий ему не вводятся. Это пробник старого вида: у него есть только общий балл.</Notice>
  }

  const filledCount = totals.filter(Boolean).length

  return (
    <div className="space-y-4" data-testid="mock-exam-grid-page">
      <header className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="min-w-0">
          <Link to="/mock-exams" className="inline-flex items-center gap-1 text-xs uppercase tracking-wider text-graphite-500 hover:text-primary-700">
            <ArrowLeft size={12} />Пробники · {template.title} · {exam.groupName ? `группа ${exam.groupName}` : 'группа'}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 [text-wrap:balance]">{exam.title} — {formatDate(exam.date)}</h1>
          <p className="text-sm text-graphite-600">
            {roster.length} {plural(roster.length, 'ученик', 'ученика', 'учеников')} · {maxPts.length} заданий · максимум {maxPrimary} первичных
            {template.score_scale ? ' · тестовый по таблице перевода' : ' · таблицы перевода нет — тестовый равен первичному'}
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={clearAll} data-testid="mock-grid-clear">Очистить таблицу</Button>
          <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty} data-testid="mock-grid-save">
            <Save size={14} />Сохранить
          </Button>
        </div>
      </header>

      {status && (
        <p
          role="status"
          data-testid="mock-grid-status"
          className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', status.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')}
        >
          {status.kind === 'error' && <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          {status.text}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-graphite-600">
        <b className="text-graphite-900">Как вставить из Excel.</b> В своей таблице выделите блок вместе со столбцом фамилий — от фамилии
        первого ученика до балла за последнее задание. Скопируйте, встаньте в любую клетку столбца «Ученик» и нажмите <b className="text-graphite-900">Ctrl + V</b>.
        Строки сопоставятся по фамилиям, а кого система не узнала — появится списком ниже. Без фамилий вставка идёт как в Excel: от выбранной клетки вправо и вниз.
      </div>

      <div className="max-h-[72vh] overflow-auto rounded-xl border border-slate-200 bg-white" data-testid="mock-grid-scroll">
        <table className="min-w-full border-separate border-spacing-0 text-center" data-testid="mock-grid">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-30 min-w-[128px] border-b border-r border-slate-200 bg-white px-2 text-left text-xs font-normal uppercase tracking-wider text-graphite-500">Ученик</th>
              {maxPts.map((m, t) => (
                <th key={t} scope="col" className={cn('sticky top-0 z-20 min-w-[35px] whitespace-nowrap border-b border-r border-slate-200 bg-white px-px pb-1 pt-1.5 font-normal', t === p1End && 'border-l-2 border-l-graphite-400')}>
                  <span className="block font-mono text-[13px] text-graphite-900">№{t + 1}</span>
                  <span className="block text-[10px] leading-tight text-graphite-500">макс {m}</span>
                </th>
              ))}
              {['1 часть', '2 часть', 'Первичный', 'Тестовый'].map((h, k) => (
                <th key={h} scope="col" className={cn('sticky top-0 z-30 border-b border-r border-slate-200 bg-white px-0.5 text-[11px] font-normal leading-tight text-graphite-500', TOT_W, TOT_STICKY[k], k === 0 && 'border-l-2 border-l-graphite-400')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roster.map((name, s) => {
              const tot = totals[s]
              return (
                <tr key={students[s].id} data-testid="mock-grid-row" data-student={students[s].id}>
                  <td
                    tabIndex={0}
                    onPaste={e => onCellPaste(e, { s, t: 0 }, false)}
                    className="sticky left-0 z-10 max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-slate-200 bg-white px-2 text-left sm:max-w-none text-sm text-graphite-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                    data-testid="mock-grid-name"
                    title={name}
                  >
                    <span className={cn('mr-2 inline-block h-[7px] w-[7px] rounded-full align-[1px]', tot ? 'bg-emerald-500' : 'bg-slate-300')} aria-hidden />
                    {name}
                  </td>
                  {maxPts.map((m, t) => {
                    const c = grid[s]?.[t]
                    const err = c?.err
                    return (
                      <td
                        key={t}
                        className={cn(
                          'border-b border-r border-slate-200 p-0',
                          s % 2 ? 'bg-slate-50/70' : 'bg-white',
                          t === p1End && 'border-l-2 border-l-graphite-400',
                          err && 'shadow-[inset_0_0_0_2px_theme(colors.red.500)]',
                        )}
                        title={err === 'over' ? `Больше максимума: за задание ${t + 1} можно не больше ${m}` : err === 'bad' ? 'Не число' : undefined}
                        data-err={err ?? undefined}
                      >
                        <input
                          id={cellId(s, t)}
                          inputMode="numeric"
                          autoComplete="off"
                          value={c?.raw ?? ''}
                          onChange={e => edit(s, t, e.target.value)}
                          onKeyDown={e => onKey(e, s, t)}
                          onPaste={e => onCellPaste(e, { s, t }, true)}
                          onFocus={e => e.currentTarget.select()}
                          aria-label={`${name}, задание ${t + 1}`}
                          aria-invalid={err ? true : undefined}
                          className={cn(
                            'h-8 w-[35px] border-0 bg-transparent p-0 text-center font-mono text-sm text-graphite-900 focus:bg-primary-50 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-primary-500',
                            err && 'font-bold text-red-700',
                          )}
                        />
                      </td>
                    )
                  })}
                  <td className={cn('z-10 border-b border-l-2 border-r border-slate-200 border-l-graphite-400 bg-white font-mono text-sm', TOT_W, TOT_STICKY[0])}>{tot?.p1 ?? ''}</td>
                  <td className={cn('z-10 border-b border-r border-slate-200 bg-white font-mono text-sm', TOT_W, TOT_STICKY[1])}>{tot?.p2 ?? ''}</td>
                  <td className={cn('z-10 border-b border-r border-slate-200 bg-white font-mono text-sm font-bold', TOT_W, TOT_STICKY[2])} data-testid="mock-grid-primary">{tot?.primary ?? ''}</td>
                  <td className={cn('z-10 border-b border-r border-slate-200 bg-white font-mono text-sm font-bold', TOT_W, TOT_STICKY[3])} data-testid="mock-grid-test">{tot ? (tot.test ?? '—') : ''}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr data-testid="mock-grid-footer">
              <td className="sticky bottom-0 left-0 z-30 border-r border-t-2 border-slate-200 border-t-graphite-400 bg-white px-2.5 py-1.5 text-left text-xs uppercase tracking-wider text-graphite-500">Набрано по номеру</td>
              {stats.map((st, t) => (
                <td
                  key={t}
                  data-testid="mock-grid-task-pct"
                  title={st.count ? `Задание ${t + 1}: набрано ${st.got} из ${st.of} у ${st.count} ${plural(st.count, 'ученика', 'учеников', 'учеников')}` : `Задание ${t + 1}: никто не решал`}
                  className={cn(
                    'sticky bottom-0 z-20 border-r border-t-2 border-slate-200 border-t-graphite-400 px-0.5 py-1.5 font-mono text-xs',
                    t === p1End && 'border-l-2 border-l-graphite-400',
                    st.level == null ? 'bg-white text-graphite-400' : HEAT[st.level],
                  )}
                >{st.pct == null ? '—' : `${st.pct}%`}</td>
              ))}
              {(['p1', 'p2', 'primary', 'test'] as const).map((k, i) => (
                <td key={k} className={cn('sticky bottom-0 z-30 border-r border-t-2 border-slate-200 border-t-graphite-400 bg-white px-0.5 py-1.5 font-mono text-xs text-graphite-700', TOT_W, TOT_STICKY[i], i === 0 && 'border-l-2 border-l-graphite-400')}>
                  {avg && avg[k] != null ? `ср. ${avg[k]}` : '—'}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 px-0.5 text-xs text-graphite-500">
        <Legend cls={HEAT[0]}>по номеру набрано меньше 40 %</Legend>
        <Legend cls={HEAT[1]}>40–60 %</Legend>
        <Legend cls={HEAT[2]}>60–80 %</Legend>
        <Legend cls={HEAT[3]}>80 % и выше</Legend>
        <Legend cls="bg-white shadow-[inset_0_0_0_2px_theme(colors.red.500)]">балл выше максимума или не число</Legend>
        <span>Пустая клетка — нет данных, 0 — решал и не получил. Заполнено строк: {filledCount} из {roster.length}.</span>
      </div>

      {report && (
        <section className="rounded-xl border border-slate-200 bg-white px-4 py-3" aria-live="polite" data-testid="mock-grid-report">
          <h3 className="mb-2 text-[15px] font-semibold text-graphite-900">{report.mode === 'cleared' ? 'Таблица очищена' : 'Что произошло со вставкой'}</h3>
          <PasteReportRows report={report} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={undoPaste} disabled={!undo} data-testid="mock-grid-undo">
              {report.mode === 'cleared' ? 'Вернуть как было' : 'Отменить вставку'}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function Row({ badge, tone, children, testid }: { badge: string; tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode; testid?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 border-t border-slate-100 py-1.5 text-sm first:border-t-0" data-testid={testid}>
      <span className={cn('whitespace-nowrap rounded px-1.5 py-px text-xs',
        tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : tone === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800')}>{badge}</span>
      <span className="min-w-0 text-graphite-700">{children}</span>
    </div>
  )
}

function PasteReportRows({ report }: { report: PasteReport | { mode: 'cleared' } }) {
  if (report.mode === 'cleared') {
    return <Row badge="очищено" tone="warn">Все клетки пустые. В базе ничего не изменится, пока вы не нажмёте «Сохранить».</Row>
  }
  const problems = report.problems.length > 0 && (
    <Row badge="проверь" tone="bad" testid="mock-report-problems">
      {report.problems.map(p => `${p.student}, №${p.task}: ${p.kind === 'over' ? `${p.value} при максимуме ${p.max}` : `«${p.value}» — не число`}`).join(' · ')} — клетки обведены красным.
    </Row>
  )
  if (report.mode === 'positional') {
    return (
      <>
        <Row badge="вставлено" tone="ok">
          {report.inserted} {plural(report.inserted, 'клетка', 'клетки', 'клеток')} — по порядку, от выбранной клетки. Фамилий в блоке не было, поэтому строки не сверялись.
          {report.outside > 0 && ` Не поместилось справа или снизу: ${report.outside} — отброшено.`}
        </Row>
        {problems}
      </>
    )
  }
  const total = report.ok.length + report.none.length + report.ambiguous.length + report.mismatch.length + report.duplicates.reduce((a, d) => a + d.rows.length, 0)
  return (
    <>
      <Row badge={`сопоставлено ${report.ok.length} из ${total}`} tone="ok" testid="mock-report-ok">
        {report.ok.length ? report.ok.map(o => (normName(o.from) === normName(o.to) ? o.to : `${o.from} → ${o.to}`)).join(' · ') : 'никого'}
      </Row>
      {report.none.length > 0 && (
        <Row badge="не найдены" tone="bad" testid="mock-report-none">
          {report.none.join(' · ')} — таких нет в группе. Их баллы <b>не вставлены никуда</b>.
        </Row>
      )}
      {report.ambiguous.map(a => (
        <Row key={`a-${a.name}`} badge="неоднозначно" tone="warn" testid="mock-report-ambiguous">
          «{a.name}» — подходят: {a.options.join(', ')}. Добавьте в Excel имя или первую букву имени и вставьте эту строку заново.
        </Row>
      ))}
      {report.mismatch.map(a => (
        <Row key={`m-${a.name}`} badge="имя не совпадает" tone="warn" testid="mock-report-mismatch">
          «{a.name}» — в группе с этой фамилией только {a.options.join(', ')}, а имя другое. Не вставлено: проверьте, тот ли это человек.
        </Row>
      ))}
      {report.duplicates.map(d => (
        <Row key={`d-${d.to}`} badge="повтор" tone="warn" testid="mock-report-duplicate">
          Строки {d.rows.map(r => `«${r}»`).join(' и ')} указывают на одного ученика — {d.to}. Какая из них его, неизвестно, поэтому не вставлена ни одна.
        </Row>
      ))}
      {problems}
      {report.extra > 0 && (
        <Row badge="лишние столбцы" tone="warn">
          В строках на {report.extra} {plural(report.extra, 'значение', 'значения', 'значений')} больше, чем заданий в пробнике. Лишнее отброшено — проверьте, что первый столбец после фамилии это задание №1.
        </Row>
      )}
    </>
  )
}

function Legend({ cls, children }: { cls: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-3 w-3 rounded-sm border border-slate-200', cls)} aria-hidden />
      {children}
    </span>
  )
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3" data-testid="mock-grid-notice">
      <Link to="/mock-exams" className="inline-flex items-center gap-1 text-sm text-graphite-500 hover:text-primary-700"><ArrowLeft size={14} />Пробники</Link>
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertCircle size={16} className="mt-0.5 shrink-0" />{children}</p>
    </div>
  )
}
