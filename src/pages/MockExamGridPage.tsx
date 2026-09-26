import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, AlertTriangle, ArrowLeft, Check, ClipboardPaste, Images, Loader2, Save, Send, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/cn'
import { useMockExamGrid, type GridLesson, type GridStudent, type GridWork } from '@/hooks/useMockExamGrid'
import { SignedFileLink } from '@/components/ui/SignedFileLink'
import { MOCK_EXAMS_BUCKET, mskDay, mskDayLong, mskTime } from '@/lib/mockExamLesson'
import { awaitsKeyCheck, cellLook, gridSummary, isWeakTask, type CellLook } from '@/lib/mockExamGridView'
import { useMockExamLive } from '@/hooks/useMockExamLive'
import {
  liveCounts, liveCountsLine, liveHeadline, livePhase, liveRows, sheetLabel,
  type LiveRow, type LiveStudentRow, type MockExamLive,
} from '@/lib/mockExamLive'
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
import { canNotify, formatSentAt, notifyState, pendingRecipients, type NotifyState, type NotifySummary } from '@/lib/mockExamNotify'

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
 *  3. сохранение — черновик (§219): никто ничего не получает. Ученику
 *     уходит его результат только по кнопке — «Уведомить» в строке или
 *     «Уведомить всех» внизу, и один и тот же итог дважды не уходит.
 */

const cellId = (s: number, t: number) => `mx-c-${s}-${t}`

/**
 * §227. Ширины столбцов по макету v2: задания по 30 точек, два итога по 44,
 * «Уведомить» — 100. Столбец «Ученик» забирает остаток (таблица `table-fixed`
 * во всю ширину), но не больше, чем позволяет `max-w` таблицы: на 1280 с
 * боковым меню все 19 заданий стоят рядом без прокрутки, длинное ФИО
 * обрезается многоточием (полное — в подсказке). Уже `min-w` таблица не
 * сжимается — на телефоне прокручивается только она, «Ученик» липкий.
 */
const TASK_W = 30
const TOT_W = 44
const NOTE_W = 100
/** Итоги и «Уведомить» закреплены справа от `sm`: при узком окне ноутбука они не уезжают за край. */
const NOTE_STICKY = 'sm:sticky sm:right-0'
const TOT_STICKY = ['sm:sticky sm:right-[144px]', 'sm:sticky sm:right-[100px]'] as const
/** Граница частей — вертикальная линия, как в макете. */
const PART_LINE = 'border-l-[1.5px] border-l-graphite-300'

export function MockExamGridPage() {
  const { id } = useParams<{ id: string }>()
  const { exam, students, points, auto, works, gradeNote, results, resultsError, loading, error, save, notify, refreshWorks } = useMockExamGrid(id)
  const lesson = exam?.lesson ?? null
  // §224. Монитор: опрос раз в 20 с, пока окно не закрыто + 15 мин; вместе с
  // ним — фото (ссылки на страницы работ).
  const { live, offset: liveOffset } = useMockExamLive(exam?.id, lesson, refreshWorks)
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
  /** Кому сейчас уходит уведомление: id ученика, 'all' или никому. */
  const [sending, setSending] = useState<string | 'all' | null>(null)
  /** Открыто подтверждение «Отправить N ученикам?» (внутри страницы, без confirm()). */
  const [confirmAll, setConfirmAll] = useState(false)
  /** §227. «Как вставить из Excel» — раскрыто кнопкой; null — само (открыто у пустой таблицы). */
  const [pasteHelp, setPasteHelp] = useState<boolean | null>(null)

  const totals = useMemo(() => grid.map(r => rowTotals(r, maxPts, p1End, template?.score_scale)), [grid, maxPts, p1End, template])
  const stats = useMemo(() => taskStats(grid, maxPts), [grid, maxPts])
  const avg = useMemo(() => averageTotals(totals), [totals])
  const maxPrimary = maxPts.reduce((a, b) => a + b, 0)
  const dirty = useMemo(() => JSON.stringify(gridToPoints(grid)) !== JSON.stringify(points) || gridErrors(grid).length > 0, [grid, points])
  // Строка, в которой есть несохранённое: уведомление ушло бы с СОХРАНЁННЫМ
  // итогом, а на экране стоит другой — кнопку в такой строке гасим.
  const dirtyRows = useMemo(() => {
    const now = gridToPoints(grid)
    return new Set(grid.map((row, s) => (row.some(c => c.err) || JSON.stringify(now[s]) !== JSON.stringify(points[s] ?? null) ? s : -1)).filter(s => s >= 0))
  }, [grid, points])
  const states = useMemo(() => students.map(st => notifyState(results[st.id])), [students, results])
  const pending = useMemo(() => pendingRecipients(students, results), [students, results])
  const withTotal = states.filter(x => x.kind !== 'none').length
  const alreadySent = states.filter(x => x.kind === 'sent').length

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
    const { error: err } = await save(gridToPoints(grid))
    setSaving(false)
    if (err) { setStatus({ kind: 'error', text: `Не сохранено: ${err}` }); return }
    setUndo(null)
    setReport(null)
    setGrid(null)
    setConfirmAll(false)
    setStatus({ kind: 'ok', text: 'Сохранено. Ученики ничего не получили — это черновик. Отправить результат: «Уведомить» в строке или «Уведомить всех» под таблицей.' })
  }

  async function onNotify(target: string | 'all') {
    setSending(target)
    setStatus(null)
    const { error: err, summary } = await notify(target === 'all' ? null : [target])
    setSending(null)
    setConfirmAll(false)
    if (err) { setStatus({ kind: 'error', text: `Не отправлено: ${err}` }); return }
    setStatus({ kind: 'ok', text: sentText(summary, target === 'all' ? null : students.find(s => s.id === target)?.name ?? null) })
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
  // §224. Пока пробник не начался, идёт или догружают фото — монитор над
  // таблицей: сначала вывод. Когда всё закрыто, главное — проверка, и блок
  // работ уходит под таблицу, как было в §221.
  const monitorOnTop = !!lesson && livePhase(lesson, Date.now() + liveOffset) !== 'ended'
  const monitor = lesson ? <LiveMonitor lesson={lesson} students={students} works={works} live={live} offset={liveOffset} part1Last={p1End} /> : null
  // §227. Вывод над таблицей — из тех же итогов и «набрано по номеру», что в таблице.
  const summary = gridSummary({ totals, stats, roster: roster.length, maxPrimary, hasScale: !!template.score_scale?.length, lessonOpen: monitorOnTop })
  // «Как вставить из Excel»: пустая таблица — открыто само (раньше текст стоял всегда), дальше — по кнопке.
  // Пока онлайн-пробник идёт, главное — монитор, подсказку не раскрываем.
  const helpOpen = pasteHelp ?? (filledCount === 0 && !monitorOnTop)
  const p2Count = maxPts.length - p1End
  const notifyAllOff = resultsError != null || pending.length === 0 || dirty || sending != null
  const notifyAllTitle = resultsError != null ? 'Не удалось прочитать, кому что отправлено'
    : dirty ? 'Сначала сохраните таблицу — отправляется сохранённый итог'
    : pending.length === 0 ? 'Отправлять некому: всем, у кого есть итог, он уже отправлен' : undefined

  function openPasteHelp() {
    setPasteHelp(!helpOpen)
    if (!helpOpen) {
      // Курсор — в первую клетку «Ученик»: Ctrl + V сразу пойдёт вставкой с фамилиями.
      requestAnimationFrame(() => (document.querySelector('[data-testid="mock-grid-name"]') as HTMLElement | null)?.focus({ preventScroll: true }))
    }
  }

  return (
    <div className="space-y-5" data-testid="mock-exam-grid-page">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 lg:flex-nowrap">
        <div className="min-w-0 max-w-[660px] space-y-2 lg:flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-graphite-500">
            <span className="min-w-0">
              <Link to="/mock-exams" className="hover:text-primary-700 hover:underline">Пробники</Link>
              {' · '}{exam.groupName ?? 'группа'}{' · '}{template.title}
            </span>
            <Link to={`/mock-exams/${exam.id}/setup`} data-testid="mock-grid-setup-link"
              className="inline-flex items-center gap-1 text-graphite-600 underline decoration-graphite-300 underline-offset-[3px] hover:text-primary-700 hover:decoration-primary-400">
              <Settings2 size={13} aria-hidden />{lesson ? 'Онлайн: ключ и файлы' : 'Настройка'}
            </Link>
          </div>
          <h1 className="text-2xl font-semibold leading-tight text-graphite-900 [text-wrap:balance] sm:text-[28px]">{exam.title} · {examDay(exam.date)}</h1>
          <p className="text-base leading-normal text-graphite-900 [text-wrap:pretty] sm:text-[17px]" data-testid="mock-grid-summary">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:pt-7">
          <Button variant="secondary" onClick={openPasteHelp} aria-expanded={helpOpen} data-testid="mock-grid-paste-button">
            <ClipboardPaste size={15} aria-hidden />Вставить из Excel
          </Button>
          {/* Главная кнопка одна: есть несохранённое — «Сохранить», иначе — «Уведомить всех». */}
          <Button variant={dirty ? 'primary' : 'ghost'} onClick={onSave} loading={saving} disabled={!dirty} data-testid="mock-grid-save"
            title={dirty ? undefined : 'Всё сохранено'}>
            {!dirty && filledCount > 0 ? <><Check size={15} aria-hidden />Сохранено</> : <><Save size={15} aria-hidden />Сохранить</>}
          </Button>
          <Button
            variant={dirty ? 'secondary' : 'primary'}
            onClick={() => { setConfirmAll(true); setStatus(null) }}
            disabled={notifyAllOff}
            title={notifyAllTitle}
            data-testid="mock-grid-notify-all"
          >
            Уведомить всех{resultsError == null ? ` · ${pending.length}` : ''}
          </Button>
        </div>
      </header>

      {confirmAll && (
        <div className="rounded-card bg-white px-4 py-3 shadow-card" role="alertdialog" aria-labelledby="mock-notify-confirm-title" data-testid="mock-grid-notify-confirm">
          <p id="mock-notify-confirm-title" className="text-[15px] font-semibold text-graphite-900">
            Отправить {pending.length} {plural(pending.length, 'ученику', 'ученикам', 'ученикам')}?
          </p>
          <p className="mt-1 text-sm text-graphite-600">
            Каждый получит только свой результат.
            {alreadySent > 0 && ` Тем, кому этот итог уже отправлен (${alreadySent}), повторно не уйдёт.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onNotify('all')} loading={sending === 'all'} data-testid="mock-grid-notify-send">
              <Send size={14} aria-hidden />Отправить
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmAll(false)} disabled={sending != null} data-testid="mock-grid-notify-cancel">Отмена</Button>
          </div>
        </div>
      )}

      {status && (
        <p
          role="status"
          data-testid="mock-grid-status"
          className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', status.kind === 'error' ? 'bg-verdict-bad-tint text-verdict-bad-ink' : 'bg-verdict-ok-tint text-verdict-ok-ink')}
        >
          {status.kind === 'error' ? <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden /> : <Check size={16} className="mt-0.5 shrink-0" aria-hidden />}
          {status.text}
        </p>
      )}

      {helpOpen && (
        <div className="max-w-[860px] border-l-[3px] border-primary-300 pl-3 text-sm leading-relaxed text-graphite-600" data-testid="mock-grid-paste-help">
          <b className="text-graphite-900">Как вставить из Excel.</b> В своей таблице выделите блок вместе со столбцом фамилий — от фамилии
          первого ученика до балла за последнее задание. Скопируйте, встаньте в любую клетку столбца «Ученик» и нажмите <b className="text-graphite-900">Ctrl + V</b>.
          Строки сопоставятся по фамилиям, а кого система не узнала — появится списком ниже. Без фамилий вставка идёт как в Excel: от выбранной клетки вправо и вниз.
        </div>
      )}

      {lesson && monitorOnTop && monitor}

      {gradeNote && (
        <p className="text-sm text-graphite-600" data-testid="mock-grid-grade-note">{gradeNote}</p>
      )}

      <div className="rounded-card bg-white px-2 pb-1.5 pt-1 shadow-card sm:px-3.5">
        <div className="max-h-[72vh] overflow-auto" data-testid="mock-grid-scroll">
          <table className="w-full min-w-[880px] max-w-[960px] table-fixed border-separate border-spacing-0 text-center text-sm" data-testid="mock-grid">
            <colgroup>
              <col />
              {maxPts.map((_, t) => <col key={t} style={{ width: TASK_W }} />)}
              <col style={{ width: TOT_W }} />
              <col style={{ width: TOT_W }} />
              <col style={{ width: NOTE_W }} />
            </colgroup>
            <thead>
              <tr className="h-6">
                <th scope="col" className="sticky left-0 top-0 z-30 bg-white" aria-hidden />
                <th scope="colgroup" colSpan={p1End} className="sticky top-0 z-20 bg-white px-1 pt-2 text-left text-[11px] font-medium uppercase tracking-[.03em] text-graphite-500">Часть 1</th>
                {p2Count > 0 && <th scope="colgroup" colSpan={p2Count} className={cn('sticky top-0 z-20 bg-white px-1.5 pt-2 text-left text-[11px] font-medium uppercase tracking-[.03em] text-graphite-500', PART_LINE)}>Часть 2</th>}
                <th colSpan={3} className="sticky top-0 z-20 bg-white" aria-hidden />
              </tr>
              <tr>
                <th scope="col" className="sticky left-0 top-6 z-30 border-b-[1.5px] border-graphite-300 bg-white pb-2 pl-1 pt-1 text-left text-xs font-medium text-graphite-500">Ученик</th>
                {maxPts.map((m, t) => (
                  <th key={t} scope="col" title={`Задание №${t + 1}, максимум ${m}`}
                    className={cn('sticky top-6 z-20 whitespace-nowrap border-b-[1.5px] border-graphite-300 bg-white px-0 pb-2 pt-1 font-normal', t === p1End && PART_LINE)}>
                    <span className="block text-[13px] font-semibold leading-tight text-graphite-900">{t + 1}</span>
                    <span className="block text-[11px] leading-tight text-graphite-500">{lesson && t < p1End ? 'авто' : `из ${m}`}</span>
                  </th>
                ))}
                <th scope="col" className={cn('sticky top-6 z-30 border-b-[1.5px] border-graphite-300 bg-white px-1 pb-2 pt-1 text-right text-xs font-medium text-graphite-500', TOT_STICKY[0])} title="Первичный балл">Перв.</th>
                <th scope="col" className={cn('sticky top-6 z-30 border-b-[1.5px] border-graphite-300 bg-white px-1 pb-2 pt-1 text-right text-xs font-medium text-graphite-500', TOT_STICKY[1])} title={template.score_scale ? 'Тестовый балл по таблице перевода' : 'Таблицы перевода нет — тестовый равен первичному'}>Тест.</th>
                <th scope="col" className={cn('sticky top-6 z-30 border-b-[1.5px] border-graphite-300 bg-white pb-2 pt-1', NOTE_STICKY)}><span className="sr-only">Ученику</span></th>
              </tr>
            </thead>
            <tbody>
              {roster.map((name, s) => {
                const tot = totals[s]
                const st = students[s]
                const rowHasAuto = !!auto[s]?.some(Boolean)
                const submitted = !!works[st.id]?.submitted_at
                return (
                  <tr key={st.id} data-testid="mock-grid-row" data-student={st.id} className="h-9">
                    <td
                      tabIndex={0}
                      onPaste={e => onCellPaste(e, { s, t: 0 }, false)}
                      className="sticky left-0 z-10 overflow-hidden text-ellipsis whitespace-nowrap border-b border-graphite-100 bg-white pl-1 pr-1.5 text-left font-medium text-graphite-900 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
                      data-testid="mock-grid-name"
                      title={name}
                    >
                      {name}
                    </td>
                    {maxPts.map((m, t) => {
                      const c = grid[s]?.[t]
                      const err = c?.err
                      // §221: «авто» — пока клетку не тронули и в базе points =
                      // auto_points. Исправил — обычная клетка, как поставленная вручную.
                      const isAuto = !!auto[s]?.[t] && c?.raw === String(points[s]?.[t] ?? '')
                      // §227. Первая часть онлайн-пробника вся «авто» (сказано в заголовке);
                      // уголком помечено исключение — балл, поставленный или исправленный вручную.
                      const isManualP1 = !!lesson && t < p1End && !isAuto && c?.v != null
                      const look = cellLook(c, m, {
                        rowHasResult: tot != null,
                        awaitsCheck: awaitsKeyCheck({ lesson: !!lesson, task: t, part1Last: p1End, submitted, rowHasAuto }),
                      })
                      return (
                        <td
                          key={t}
                          data-auto={isAuto || undefined}
                          data-look={look}
                          className={cn('relative border-b border-graphite-100 p-0', t === p1End && PART_LINE)}
                          title={err === 'over' ? `Больше максимума: за задание ${t + 1} можно не больше ${m}` : err === 'bad' ? 'Не число' : isAuto ? 'Проверено по ключу. Исправь, если в ключе опечатка — клетка станет ручной' : isManualP1 ? 'Поставлено или исправлено вручную' : look === 'unk' ? 'Не сверено: ключ этот ответ не проверил — поставьте балл сами' : undefined}
                          data-err={err ?? undefined}
                        >
                          <input
                            id={cellId(s, t)}
                            inputMode="numeric"
                            autoComplete="off"
                            value={c?.raw ?? ''}
                            placeholder={look === 'unk' ? '?' : look === 'none' ? '—' : undefined}
                            onChange={e => edit(s, t, e.target.value)}
                            onKeyDown={e => onKey(e, s, t)}
                            onPaste={e => onCellPaste(e, { s, t }, true)}
                            onFocus={e => e.currentTarget.select()}
                            aria-label={`${name}, задание ${t + 1}`}
                            aria-invalid={err ? true : undefined}
                            className={cn(
                              'mx-[2px] my-1 box-border block h-[27px] w-[calc(100%-4px)] rounded border-0 bg-transparent p-0 text-center text-sm text-graphite-900 focus:bg-primary-50 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-primary-500',
                              CELL_CLS[look],
                            )}
                          />
                          {isManualP1 && <span data-testid="mock-grid-manual-mark" className="pointer-events-none absolute right-[3px] top-[5px] h-0 w-0 border-l-[5px] border-t-[5px] border-l-transparent border-t-graphite-400" aria-hidden />}
                        </td>
                      )
                    })}
                    <td className={cn('z-10 border-b border-graphite-100 bg-white px-1 text-right font-semibold text-graphite-900', TOT_STICKY[0])} data-testid="mock-grid-primary"
                      title={tot ? `1 часть — ${tot.p1} · 2 часть — ${tot.p2}` : undefined}>{tot?.primary ?? ''}</td>
                    <td className={cn('z-10 border-b border-graphite-100 bg-white px-1 text-right font-semibold text-graphite-900', TOT_STICKY[1])} data-testid="mock-grid-test">{tot ? (tot.test ?? '—') : ''}</td>
                    <td className={cn('z-10 border-b border-graphite-100 bg-white py-1 pl-2 pr-0.5 text-left', NOTE_STICKY)} data-testid="mock-grid-notify-cell">
                      <NotifyCell
                        state={states[s]}
                        unavailable={resultsError != null}
                        dirty={dirtyRows.has(s)}
                        noProfile={!st.profileId}
                        busy={sending === st.id || sending === 'all'}
                        disabled={sending != null}
                        onClick={() => onNotify(st.id)}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr data-testid="mock-grid-footer">
                <td className="sticky bottom-0 left-0 z-30 border-t-[1.5px] border-graphite-300 bg-white py-2 pl-1 pr-1 text-left text-xs font-medium leading-tight text-graphite-500">Набрано по номеру, %</td>
                {stats.map((st, t) => {
                  const weak = isWeakTask(st)
                  return (
                    <td
                      key={t}
                      data-testid="mock-grid-task-pct"
                      data-weak={weak || undefined}
                      title={st.count ? `Задание ${t + 1}: набрано ${st.got} из ${st.of} у ${st.count} ${plural(st.count, 'ученика', 'учеников', 'учеников')}${weak ? ' — меньше трети от максимума' : ''}` : `Задание ${t + 1}: никто не решал`}
                      className={cn('sticky bottom-0 z-20 border-t-[1.5px] border-graphite-300 bg-white p-0', t === p1End && PART_LINE)}
                    >
                      <span className={cn(
                        'mx-[2px] my-1 flex h-[27px] items-center justify-center rounded text-[13px]',
                        weak ? 'border border-verdict-bad bg-verdict-bad-tint font-bold text-verdict-bad-ink' : st.pct == null ? 'text-graphite-400' : 'text-graphite-500',
                      )}>{st.pct == null ? '—' : st.pct}</span>
                    </td>
                  )
                })}
                <td className={cn('sticky bottom-0 z-30 border-t-[1.5px] border-graphite-300 bg-white px-1 text-right text-[13px] text-graphite-600', TOT_STICKY[0])}
                  title={avg ? `Средний первичный; 1 часть — ${avg.p1}, 2 часть — ${avg.p2}` : undefined} data-testid="mock-grid-avg-primary">{avg ? avg.primary : '—'}</td>
                <td className={cn('sticky bottom-0 z-30 border-t-[1.5px] border-graphite-300 bg-white px-1 text-right text-[13px] text-graphite-600', TOT_STICKY[1])}
                  title="Средний тестовый" data-testid="mock-grid-avg-test">{avg && avg.test != null ? avg.test : '—'}</td>
                <td className={cn('sticky bottom-0 z-30 border-t-[1.5px] border-graphite-300 bg-white pl-2 text-left text-xs leading-tight text-graphite-500', NOTE_STICKY)}>
                  {filledCount ? `средний по ${filledCount} ${plural(filledCount, 'работе', 'работам', 'работам')}` : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-graphite-500 sm:text-xs" data-testid="mock-grid-legend">
            <LegendCell look="full" v="2">полный балл</LegendCell>
            <LegendCell look="part" v="1">частично</LegendCell>
            <LegendCell look="zero" v="0">неверно</LegendCell>
            <LegendCell look="unk" v="?">не сверено</LegendCell>
            <LegendCell look="none" v="—">не решено — пустая клетка, в % не входит</LegendCell>
            <LegendCell look="err" v="5">не число или больше максимума</LegendCell>
            {lesson && (
              <span className="inline-flex items-center gap-1.5">
                <span className="relative inline-block h-5 w-[22px] rounded-[3px] border border-graphite-200" aria-hidden>
                  <span className="absolute right-[2px] top-[2px] h-0 w-0 border-l-[5px] border-t-[5px] border-l-transparent border-t-graphite-400" />
                </span>
                первая часть — по ключу (авто); уголок — поставлено или исправлено вручную
              </span>
            )}
          </div>
          <p className="text-[13px] text-graphite-500 sm:text-xs">
            {roster.length} {plural(roster.length, 'ученик', 'ученика', 'учеников')} · {maxPts.length} заданий · максимум {maxPrimary} первичных
            {template.score_scale ? ' · тестовый по таблице перевода' : ' · таблицы перевода нет — тестовый равен первичному'}
            {' · '}баллы по частям — в подсказке у первичного
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={clearAll} data-testid="mock-grid-clear" className="text-graphite-600">Очистить таблицу</Button>
      </div>

      <section className="text-sm text-graphite-600" data-testid="mock-grid-notify-bar">
        <p>
          <b className="font-semibold text-graphite-900">Результат ученикам.</b>{' '}
          {resultsError
            ? <>Не удалось прочитать, кому что отправлено ({resultsError}) — отправка недоступна.</>
            : <>Итог сохранён у {withTotal} из {roster.length} · уже отправлено {alreadySent} · ждут отправки {pending.length}. Уходит на сайт и в Telegram, если ученик его подключил; в тексте — итог и части, без баллов по заданиям.</>}
        </p>
        {dirty && !resultsError && pending.length > 0 && (
          <p className="mt-1 text-verdict-part-ink" data-testid="mock-grid-notify-dirty">В таблице есть несохранённые правки — сначала «Сохранить»: отправляется сохранённый итог.</p>
        )}
      </section>

      {lesson && !monitorOnTop && monitor}

      {report && (
        <section className="rounded-card bg-white px-4 py-3 shadow-card" aria-live="polite" data-testid="mock-grid-report">
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

/**
 * §227. Вид клетки по состоянию. Кроме заливки у каждого своя форма — рамка
 * у нуля, черта снизу у частичного, пунктир у «не сверено», тире у «не
 * решено»: рамки и текст печатаются, фон браузер по умолчанию не печатает.
 */
const CELL_CLS: Record<CellLook, string> = {
  full: '',
  part: 'border-b-2 border-solid border-verdict-part bg-verdict-part-tint font-semibold text-verdict-part-ink',
  zero: 'border border-solid border-verdict-bad bg-verdict-bad-tint font-bold text-verdict-bad-ink',
  unk: 'border-[1.5px] border-dashed border-verdict-unk bg-white font-semibold placeholder:font-semibold placeholder:text-verdict-unk',
  none: 'placeholder:text-graphite-400',
  empty: '',
  err: 'bg-white font-bold text-red-700 shadow-[inset_0_0_0_2px_theme(colors.red.600)]',
}

function LegendCell({ look, v, children }: { look: CellLook; v: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('box-border inline-flex h-5 w-[22px] items-center justify-center rounded-[3px] text-xs font-medium text-graphite-900', CELL_CLS[look], look === 'unk' && 'text-verdict-unk', look === 'none' && 'text-graphite-400')} aria-hidden>{v}</span>
      {children}
    </span>
  )
}

/** «20 сентября»; год — только если не нынешний. */
function examDay(date: string): string {
  const day = mskDayLong(date)
  const y = new Date(date).getFullYear()
  return Number.isFinite(y) && y !== new Date().getFullYear() ? `${day} ${y}` : day
}

function Row({ badge, tone, children, testid }: { badge: string; tone: 'ok' | 'warn' | 'bad'; children: React.ReactNode; testid?: string }) {
  return (
    <div className="flex items-baseline gap-2.5 border-t border-graphite-100 py-1.5 text-sm first:border-t-0" data-testid={testid}>
      <span className={cn('whitespace-nowrap rounded px-1.5 py-px text-xs font-medium',
        tone === 'ok' ? 'bg-verdict-ok-tint text-verdict-ok-ink' : tone === 'warn' ? 'bg-verdict-part-tint text-verdict-part-ink' : 'bg-verdict-bad-tint text-verdict-bad-ink')}>{badge}</span>
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

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3" data-testid="mock-grid-notice">
      <Link to="/mock-exams" className="inline-flex items-center gap-1 text-[13px] text-graphite-500 hover:text-primary-700"><ArrowLeft size={14} aria-hidden />Пробники</Link>
      <h1 className="text-2xl font-semibold text-graphite-900 sm:text-[28px]">{title}</h1>
      <p className="flex max-w-[660px] items-start gap-2 rounded-lg bg-verdict-part-tint px-3 py-2 text-[15px] text-verdict-part-ink"><AlertCircle size={16} className="mt-1 shrink-0" aria-hidden />{children}</p>
    </div>
  )
}

/** Что сказать после отправки — по ответу базы, а не по тому, что ждали. */
function sentText(r: NotifySummary | null, name: string | null): string {
  if (!r) return 'Отправлено.'
  if (r.sent === 0) {
    if (r.already > 0) return name ? `${name}: этот итог уже отправлен — повторно не ушло.` : 'Никому не ушло: всем, у кого есть итог, он уже отправлен.'
    if (r.no_result > 0) return 'Не отправлено: у ученика нет сохранённого итога.'
    if (r.no_profile > 0) return 'Не отправлено: у ученика нет учётной записи.'
    return 'Отправлять некому.'
  }
  const who = name ? `${name}: результат отправлен.` : `Отправлено ${r.sent} ${plural(r.sent, 'ученику', 'ученикам', 'ученикам')}.`
  const tg = r.telegram > 0
    ? ` В Telegram — ${r.sent === r.telegram && name ? 'тоже' : `${r.telegram} из ${r.sent}`}, в течение пяти минут.`
    : ' Telegram не подключён — только на сайте.'
  const skipped = r.already > 0 && !name ? ` Уже отправленный итог повторно не ушёл: ${r.already}.` : ''
  return who + tg + skipped
}

/**
 * Клетка «Ученику» в строке. Четыре состояния — из `notifyState`: итога нет
 * (кнопка недоступна), итог не отправлялся, отправлен этот же итог (кнопки
 * нет — повторно тот же итог не шлём), итог изменился после отправки
 * (кнопка снова доступна и сказано почему).
 */
function NotifyCell({ state, unavailable, dirty, noProfile, busy, disabled, onClick }: {
  state: NotifyState
  unavailable: boolean
  dirty: boolean
  noProfile: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  if (unavailable) return <span className="text-xs text-graphite-400">—</span>
  if (state.kind === 'sent') {
    return (
      <span className="flex items-start gap-1 text-xs leading-tight text-graphite-500" data-testid="mock-grid-notified" title="Этот итог ученику уже отправлен">
        <Check size={12} className="mt-px shrink-0 text-verdict-ok" aria-hidden />
        <span>отправлено {formatSentAt(state.at)}</span>
      </span>
    )
  }
  const reason = state.kind === 'none'
    ? 'Нет сохранённого итога — отправлять нечего'
    : dirty ? 'В строке несохранённые правки — сначала «Сохранить»'
    : noProfile ? 'У ученика нет учётной записи'
    : undefined
  const off = !canNotify(state) || dirty || noProfile || disabled
  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={onClick}
        disabled={off}
        title={reason}
        aria-label={state.kind === 'none' ? 'Уведомить — нет итога' : undefined}
        data-testid="mock-grid-notify"
        className={cn(
          'inline-flex min-h-7 items-center gap-1 text-[13px] font-medium underline underline-offset-[3px] transition-colors',
          off
            ? 'cursor-not-allowed text-graphite-400 no-underline'
            : 'text-graphite-900 decoration-graphite-300 hover:text-primary-700 hover:decoration-primary-400',
        )}
      >
        {busy && <Loader2 size={12} className="animate-spin" aria-hidden />}
        {/* §227. Итога нет — строка тихая: вместо недоступного «Уведомить» сказано почему. */}
        {state.kind === 'none' ? <span className="text-xs">нет итога</span> : 'Уведомить'}
      </button>
      {state.kind === 'changed' && (
        <span className="text-[11px] leading-tight text-verdict-part-ink" data-testid="mock-grid-notify-changed" title={`Отправлен ${formatSentAt(state.at)}, с тех пор итог изменился`}>
          итог изменён после отправки
        </span>
      )}
    </div>
  )
}

/**
 * §221 → §224. Работы учеников онлайн-пробника — тот же блок, расширенный до
 * монитора: сверху вывод словами («Идёт · осталось 2 ч 13 мин · до 14:00»),
 * под ним одна строка счётчиков с числом группы, ниже — ученики по
 * состояниям (не заходили → открывали и ушли → пишут → сдали), бланк
 * «8 из 12», фото ссылками. «Онлайн» считает база (`mock_exam_live`), время —
 * от её `server_now`. Без функции (ветка раньше миграции) — то, что видно из
 * бланков и фото §221: кто сдал, у кого бланк есть, фото.
 */
function LiveMonitor({ lesson, students, works, live, offset, part1Last }: {
  lesson: GridLesson
  students: GridStudent[]
  works: Record<string, GridWork>
  live: MockExamLive | null
  offset: number
  part1Last: number
}) {
  const now = useServerClock(offset, 15_000)
  const phase = livePhase(lesson, now)
  const base: LiveStudentRow[] = live
    ? live.students
    : students.map(st => ({
        student_id: st.id, name: st.name, has_sheet: !!works[st.id], opened_at: null, last_seen_at: null, online: false,
        answered: null, submitted_at: works[st.id]?.submitted_at ?? null, photos: works[st.id]?.photos.length ?? 0,
      }))
  const rows = liveRows(base, phase)
  const counts = liveCounts(rows)
  const started = phase !== 'upcoming'
  const startMs = new Date(lesson.starts_at).getTime()
  const endMs = new Date(lesson.ends_at).getTime()
  const elapsed = phase === 'running' ? Math.min(1, Math.max(0, (now - startMs) / (endMs - startMs))) : phase === 'upcoming' ? 0 : 1
  return (
    <section className="rounded-card bg-white px-4 py-3.5 shadow-card sm:px-5" data-testid="mock-grid-works" data-phase={phase}>
      <p className="text-xs font-medium uppercase tracking-[.03em] text-graphite-500">Онлайн-пробник · {mskDay(lesson.starts_at)}, {mskTime(lesson.starts_at)}–{mskTime(lesson.ends_at)}, фото до {mskTime(lesson.photos_until)}</p>
      <p className={cn('mt-1 flex items-start gap-2 text-xl font-semibold leading-snug', phase === 'running' ? 'text-primary-700' : phase === 'photos' ? 'text-verdict-part-ink' : 'text-graphite-900')} data-testid="mock-live-headline">
        {phase === 'running' && <span className="relative mt-2.5 flex h-2.5 w-2.5 shrink-0" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary-600" /></span>}
        {liveHeadline(lesson, now)}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-graphite-100" aria-hidden>
        <div className={cn('h-full rounded-full', phase === 'running' ? 'bg-gradient-to-r from-action-from to-action-to' : phase === 'photos' ? 'bg-gold-300' : 'bg-graphite-300')} style={{ width: `${Math.round(elapsed * 100)}%` }} />
      </div>
      <p className="mt-2 text-[15px] text-graphite-900" data-testid="mock-live-counts">
        {liveCountsLine(counts, phase)}
        {!live && started && <span className="text-graphite-500"> · кто сейчас на сайте — появится после обновления базы</span>}
      </p>
      <div className="mt-2 divide-y divide-graphite-100 border-t border-graphite-200">
        {rows.map(r => {
          const w = works[r.student_id]
          // Не заходил — бланка нет, «0 из 12» было бы шумом; «фото нет» у
          // пишущего — тоже: фото вторая часть шлёт в конце.
          const sheet = r.has_sheet ? sheetLabel(r.answered, part1Last) : ''
          const noPhotosWorthSaying = started && (r.kind === 'submitted' || phase !== 'running')
          return (
            <div key={r.student_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-testid="mock-grid-work-row" data-kind={r.kind}>
              <span className="min-w-[11rem] flex-1 font-medium text-graphite-900 sm:flex-none">{r.name}</span>
              <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', TONE_CLS[r.tone])} data-testid="mock-live-status">
                {r.tone === 'problem' && <AlertTriangle size={12} aria-hidden />}
                {r.tone === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-verdict-ok" aria-hidden />}
                {r.label}
              </span>
              {sheet && <span className="text-[13px] tabular-nums text-graphite-500">{sheet}</span>}
              {w && w.photos.length > 0 ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Images size={13} className="text-graphite-400" aria-hidden />
                  <span className="text-[13px] text-graphite-500">фото {w.photos.length}:</span>
                  {w.photos.map((p, i) => (
                    <SignedFileLink key={p.id} bucket={MOCK_EXAMS_BUCKET} url={p.storage_path} sensitive
                      className="rounded-full border border-graphite-300 px-2 py-px text-xs font-medium text-primary-700 hover:border-primary-500">
                      стр. {i + 1}
                    </SignedFileLink>
                  ))}
                </span>
              ) : r.photos > 0 ? (
                <span className="text-[13px] text-graphite-500">фото {r.photos}</span>
              ) : noPhotosWorthSaying ? (
                <span className="text-[13px] text-graphite-500">фото нет</span>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** §227. Метки монитора — краски состояний дизайн-системы (§225); «проблема» ещё и со значком. */
const TONE_CLS: Record<LiveRow['tone'], string> = {
  problem: 'bg-verdict-bad-tint text-verdict-bad-ink',
  warn: 'bg-verdict-part-tint text-verdict-part-ink',
  live: 'bg-verdict-ok-tint text-verdict-ok-ink',
  ok: 'bg-graphite-100 text-graphite-700',
  idle: 'bg-graphite-50 text-graphite-500',
}

/** «Сейчас» по часам базы с заданным шагом — монитору хватает минут. */
function useServerClock(offset: number, stepMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offset)
  useEffect(() => {
    setNow(Date.now() + offset)
    const id = setInterval(() => setNow(Date.now() + offset), stepMs)
    return () => clearInterval(id)
  }, [offset, stepMs])
  return now
}
