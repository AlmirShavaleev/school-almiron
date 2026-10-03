import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react'
import { useLiveWork } from '@/hooks/useLiveWork'
import { useServerNow, setPersonalWindow } from '@/hooks/useTimedWork'
import {
  awayLabel, canReopen, filterCounts, liveCounters, liveRows, statusLabel, studentStatus, workPhase,
  type LiveCounters, type LiveFilter, type LiveStudentRow, type LiveStudentStatus, type LiveWork, type WorkPhase,
} from '@/lib/liveWork'
import {
  TOPIC_KIND_LABEL, formatCountdown, formatMoscowDay, formatMoscowTime, isTimerWarning, moscowParts, parseWindowDraft,
  type WindowDraft,
} from '@/lib/timedWork'
import { plural } from '@/lib/plural'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'

/**
 * §263. «Проверочная вживую» — экран учителя у работы по времени (макет,
 * вкладка А). Пока окно идёт: таймер до конца по серверу, счётчики (пишут ·
 * открыли условие / пишут без фото — в конце работа не уйдёт / загрузили фото,
 * не сдали / сдали / не открывали), таблица учеников с фильтрами и «Открыть
 * заново» (личное окно §240). После конца — тот же экран, итог: сдал сам /
 * ушло автоматически / не писал. Обновляется сам раз в 15 с.
 *
 * Стык с a264 (напоминания в Telegram): над таблицей у заголовка «Ученики · N»
 * есть место `studentsActions` — туда встанет кнопка «Напомнить «без фото» в
 * Telegram»; список адресатов — `liveRows(rows, 'no_photo', now)`.
 */
export function LiveWorkPage({ studentsActions }: { studentsActions?: ReactNode } = {}) {
  const { homeworkId } = useParams<{ homeworkId: string }>()
  const { data, error, loading, offsetMs, reload } = useLiveWork(homeworkId ?? null)
  const now = useServerNow(offsetMs, !!data)
  const [filter, setFilter] = useState<LiveFilter>('all')

  if (loading && !data) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-graphite-500" data-testid="live-work-loading">
        <Loader2 size={18} className="animate-spin" aria-hidden />Загрузка работы…
      </div>
    )
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-3xl space-y-3" data-testid="live-work-error">
        <BackLink courseId={null} />
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error?.includes('прав') ? 'Нет доступа к этой работе.' : 'Работа не загрузилась — обновите страницу чуть позже.'}
        </p>
      </div>
    )
  }

  const phase = workPhase(data, now)
  const counters = liveCounters(data.students, now)
  return (
    <div className="mx-auto max-w-[1100px] space-y-4" data-testid="live-work" data-phase={phase}>
      <BackLink courseId={data.courseId} />
      <Head data={data} phase={phase} now={now} />
      <Counters phase={phase} counters={counters} closesAt={data.closesAt} />
      <Students
        data={data}
        now={now}
        filter={filter}
        onFilter={setFilter}
        onReopened={reload}
        actions={studentsActions}
      />
      <p className="px-1 text-[12.5px] text-graphite-500" data-testid="live-work-note">
        {phase === 'after'
          ? 'Работа закончилась. Здесь итог: кто сдал сам, кому ушло автоматически, кто не писал. Проверка — в очереди «Проверка ДЗ».'
          : 'Экран обновляется сам каждые 15 секунд. Время — по серверу.'}
        {error && <span className="ml-1 text-amber-800">Последнее обновление не прошло — повторим.</span>}
      </p>
    </div>
  )
}

function BackLink({ courseId }: { courseId: string | null }) {
  return (
    <Link
      to={courseId ? `/course-program?courseId=${courseId}&tab=assessments` : '/course-program'}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary-700 hover:underline sm:min-h-0"
    >
      <ArrowLeft size={15} aria-hidden />Проверочные и контрольные
    </Link>
  )
}

function Head({ data, phase, now }: { data: LiveWork; phase: WorkPhase; now: number }) {
  const left = data.closesAt ? Date.parse(data.closesAt) - now : 0
  const warn = phase === 'live' && isTimerWarning(left)
  const eyebrow = phase === 'live' ? `Идёт ${data.kind === 'check' ? 'проверочная' : 'контрольная'}`
    : phase === 'after' ? `${TOPIC_KIND_LABEL[data.kind]} · итог`
      : phase === 'before' ? `${TOPIC_KIND_LABEL[data.kind]} · скоро` : TOPIC_KIND_LABEL[data.kind]
  const generalLive = !!data.closesAt && now < Date.parse(data.closesAt) && !!data.opensAt && now >= Date.parse(data.opensAt)
  return (
    <section
      data-testid="live-work-head"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[22px] bg-[linear-gradient(120deg,#1f55e0_0%,#2d67f5_65%,#3b7bff_100%)] px-5 py-4 text-white shadow-[0_16px_40px_rgba(31,85,224,0.22)] sm:px-6"
    >
      <div className="min-w-0">
        <div className="text-[11.5px] font-extrabold uppercase tracking-[0.08em] text-gold-200">
          {eyebrow}{data.groupName ? ` · ${data.groupName}` : ''}
        </div>
        <h1 className="mt-0.5 text-xl font-extrabold leading-tight sm:text-2xl" data-testid="live-work-title">{data.title}</h1>
        <div className="mt-1 text-[13px] text-primary-100">
          {data.opensAt
            ? `${formatMoscowDay(data.opensAt)} · ${formatMoscowTime(data.opensAt)}–${formatMoscowTime(data.closesAt)}${now >= Date.parse(data.opensAt) ? ` · условие открыто в ${formatMoscowTime(data.opensAt)}` : ''}`
            : 'время не назначено'}
        </div>
      </div>
      {generalLive ? (
        <div className={cn('rounded-2xl px-4 py-2 text-right', warn ? 'bg-verdict-bad-ink' : 'bg-white/15')} data-testid="live-work-timer" data-warn={warn ? 'true' : 'false'}>
          <div className="text-[11.5px] text-primary-100">до конца</div>
          <div className="text-[30px] font-extrabold leading-none tabular-nums">{formatCountdown(left)}</div>
        </div>
      ) : phase === 'live' ? (
        <div className="rounded-2xl bg-white/15 px-4 py-2 text-[13px] font-bold" data-testid="live-work-personal">идёт личное время</div>
      ) : null}
    </section>
  )
}

function Tile({ n, label, tone = 'plain', testId }: { n: number; label: string; tone?: 'plain' | 'warn' | 'ok' | 'bad'; testId: string }) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex min-w-0 flex-col gap-0.5 rounded-2xl px-3.5 py-3 ring-1',
        tone === 'warn' ? 'bg-gold-50 ring-gold-300' : tone === 'ok' ? 'bg-verdict-ok-tint ring-transparent' : tone === 'bad' ? 'bg-verdict-bad-tint ring-transparent' : 'bg-white ring-graphite-200',
      )}
    >
      <b className={cn('text-[26px] font-extrabold leading-none tabular-nums', tone === 'warn' ? 'text-gold-800' : tone === 'ok' ? 'text-verdict-ok-ink' : tone === 'bad' ? 'text-verdict-bad-ink' : 'text-graphite-900')}>{n}</b>
      <span className="text-[12.5px] leading-snug text-graphite-700">{label}</span>
    </div>
  )
}

function Counters({ phase, counters: c, closesAt }: { phase: WorkPhase; counters: LiveCounters; closesAt: string | null }) {
  if (phase === 'after') {
    return (
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="live-work-counters" data-mode="after">
        <Tile n={c.self} label="сдал сам" tone="ok" testId="live-count-self" />
        <Tile n={c.auto} label="ушло автоматически" testId="live-count-auto" />
        <Tile n={c.missed} label="не писал или без фото" tone={c.missed > 0 ? 'bad' : 'plain'} testId="live-count-missed" />
        <Tile n={c.away} label={`${plural(c.away, 'уходил', 'уходили', 'уходили')} со страницы`} testId="live-count-away" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" data-testid="live-work-counters" data-mode="live">
      <Tile n={c.opened} label={`${plural(c.opened, 'пишет', 'пишут', 'пишут')} · ${plural(c.opened, 'открыл', 'открыли', 'открыли')} условие`} testId="live-count-opened" />
      <Tile n={c.noPhoto} label={`без фото — ${closesAt ? `в ${formatMoscowTime(closesAt)} ` : ''}работа не уйдёт`} tone={c.noPhoto > 0 ? 'warn' : 'plain'} testId="live-count-nophoto" />
      <Tile n={c.photos} label="загрузили фото, не сдали" testId="live-count-photos" />
      <Tile n={c.submitted} label="сдали" tone="ok" testId="live-count-submitted" />
      <Tile n={c.notOpened} label="не открывали" tone={c.notOpened > 0 ? 'bad' : 'plain'} testId="live-count-notopened" />
    </div>
  )
}

const CHIP: Record<LiveStudentStatus, string> = {
  submitted: 'bg-verdict-ok-tint text-verdict-ok-ink',
  auto: 'bg-verdict-ok-tint text-verdict-ok-ink',
  sending: 'bg-primary-50 text-primary-700',
  photos: 'bg-primary-50 text-primary-700',
  writing: 'bg-gold-50 text-gold-800',
  not_opened: 'bg-verdict-bad-tint text-verdict-bad-ink',
  missed: 'bg-verdict-bad-tint text-verdict-bad-ink',
  waiting: 'bg-verdict-none-tint text-verdict-none-ink',
}

function Students({ data, now, filter, onFilter, onReopened, actions }: {
  data: LiveWork
  now: number
  filter: LiveFilter
  onFilter: (f: LiveFilter) => void
  onReopened: () => void
  actions?: ReactNode
}) {
  const counts = filterCounts(data.students, now)
  const rows = liveRows(data.students, filter, now)
  const [reopenFor, setReopenFor] = useState<string | null>(null)
  const filters: { key: LiveFilter; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'no_photo', label: `Без фото · ${counts.no_photo}` },
    { key: 'not_opened', label: `Не открывали · ${counts.not_opened}` },
    { key: 'away', label: `Уходили со страницы · ${counts.away}` },
  ]
  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white" aria-labelledby="live-students-title" data-testid="live-work-students">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-4">
        <h2 id="live-students-title" className="text-base font-extrabold text-graphite-900">Ученики · {data.students.length}</h2>
        {actions}
      </div>
      <div role="group" aria-label="Фильтр учеников" className="flex flex-wrap gap-1.5 px-4 pt-3" data-testid="live-work-filters">
        {filters.map(f => (
          <button
            key={f.key}
            type="button"
            data-key={f.key}
            aria-pressed={filter === f.key}
            onClick={() => onFilter(f.key)}
            className={cn(
              'min-h-11 rounded-full px-3.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:min-h-9',
              filter === f.key ? 'bg-primary-600 text-white' : 'bg-slate-100 text-graphite-700 hover:bg-slate-200',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-5 text-sm text-graphite-500" data-testid="live-work-empty">
          {data.students.length === 0 ? 'В классе пока нет учеников.' : 'Таких учеников нет.'}
        </p>
      ) : (
        <div role="table" aria-label="Ученики" className="mt-3 text-[13.5px]">
          <div role="rowgroup" className="hidden md:block">
            <div role="row" className={cn('grid items-center gap-3 border-y border-gray-100 bg-slate-50 px-4 py-2 text-[11px] font-extrabold uppercase tracking-wider text-graphite-600', GRID)}>
              <span role="columnheader">Ученик</span>
              <span role="columnheader">Статус</span>
              <span role="columnheader">Открыл условие</span>
              <span role="columnheader" className="text-right">Фото</span>
              <span role="columnheader">Последнее фото</span>
              <span role="columnheader">Уходил со страницы</span>
              <span role="columnheader"><span className="sr-only">Действия</span></span>
            </div>
          </div>
          <div role="rowgroup">
            {rows.map(s => (
              <Row
                key={s.studentId}
                s={s}
                now={now}
                homeworkId={data.homeworkId}
                general={{ opensAt: data.opensAt, closesAt: data.closesAt }}
                formOpen={reopenFor === s.studentId}
                onToggleForm={open => setReopenFor(open ? s.studentId : null)}
                onReopened={() => { setReopenFor(null); onReopened() }}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

const GRID = 'md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.5fr)_96px_48px_96px_minmax(0,1.2fr)_136px]'

function Row({ s, now, homeworkId, general, formOpen, onToggleForm, onReopened }: {
  s: LiveStudentRow
  now: number
  homeworkId: string
  general: { opensAt: string | null; closesAt: string | null }
  formOpen: boolean
  onToggleForm: (open: boolean) => void
  onReopened: () => void
}) {
  const st = studentStatus(s, now)
  const reopen = canReopen(s, now)
  const away = awayLabel(s.awayCount, s.awaySeconds)
  // Телефон: имя и кнопка — первой строкой, статус и подробности — второй.
  // С md та же разметка — строка таблицы (`md:contents`).
  return (
    <div
      role="row"
      data-testid="live-work-row"
      data-status={st}
      className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-gray-100 px-4 py-3 md:py-2.5', GRID)}
    >
      <span role="cell" className="col-start-1 row-start-1 min-w-0 font-semibold text-graphite-900 md:col-start-auto md:row-start-auto md:font-medium">
        {s.name}
        {s.personal && <span className="ml-1.5 text-[11.5px] font-medium text-graphite-500">личное время</span>}
      </span>
      <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
        <span role="cell">
          <span className={cn('inline-block rounded-full px-2.5 py-0.5 text-[11.5px] font-bold leading-snug', CHIP[st])} data-testid="live-work-status">
            {statusLabel(s, now)}
          </span>
        </span>
        <span role="cell" className="text-xs tabular-nums text-graphite-700 md:text-[13px]">
          <span className="md:hidden">открыл </span>{s.openedAt ? formatMoscowTime(s.openedAt) : '—'}
        </span>
        <span role="cell" className="text-xs tabular-nums text-graphite-700 md:text-right md:text-[13px]">
          <span className="md:hidden">фото </span>{s.photos > 0 || s.openedAt ? s.photos : '—'}
        </span>
        <span role="cell" className={cn('text-xs tabular-nums text-graphite-700 md:block md:text-[13px]', !s.lastPhotoAt && 'hidden')}>
          <span className="md:hidden">последнее фото </span>{s.lastPhotoAt ? formatMoscowTime(s.lastPhotoAt) : '—'}
        </span>
        <span role="cell" className={cn('text-xs md:block md:text-[13px]', s.awayCount > 0 ? 'font-bold text-verdict-bad-ink' : 'hidden text-graphite-500')} data-testid="live-work-away">
          {s.awayCount > 0 && <span className="font-medium md:hidden">уходил со страницы </span>}{away}
        </span>
      </span>
      <span role="cell" className="col-start-2 row-start-1 flex justify-end md:col-start-auto md:row-start-auto">
        {reopen && !formOpen && (
          <button
            type="button"
            data-testid="live-work-reopen"
            onClick={() => onToggleForm(true)}
            className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-[12.5px] font-bold text-graphite-800 hover:border-primary-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 md:min-h-8"
          >
            {st === 'waiting' ? 'Изменить время' : 'Открыть заново'}
          </button>
        )}
      </span>
      {formOpen && (
        <div className="col-span-2 md:col-span-7">
          <ReopenForm
            homeworkId={homeworkId}
            studentId={s.studentId}
            initial={reopenDraft(general, now)}
            onCancel={() => onToggleForm(false)}
            onDone={onReopened}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Черновик личного окна: сегодня, с ближайших пяти минут, длительностью как у
 * общего окна (не меньше 15 минут).
 */
export function reopenDraft(general: { opensAt: string | null; closesAt: string | null }, nowMs: number): WindowDraft {
  const lenMs = general.opensAt && general.closesAt
    ? Math.max(15 * 60e3, Date.parse(general.closesAt) - Date.parse(general.opensAt))
    : 45 * 60e3
  const start = Math.ceil(nowMs / (5 * 60e3)) * 5 * 60e3
  const o = moscowParts(start)
  const c = moscowParts(start + lenMs)
  // Окно в один день (как у учителя в «Работе»): ночной переход — до 23:59.
  return { date: o.date, opens: o.time, closes: c.date === o.date ? c.time : '23:59' }
}

function ReopenForm({ homeworkId, studentId, initial, onCancel, onDone }: {
  homeworkId: string
  studentId: string
  initial: WindowDraft
  onCancel: () => void
  onDone: () => void
}) {
  const [draft, setDraft] = useState<WindowDraft>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = 'min-h-11 rounded-lg border border-gray-200 px-2 text-sm md:min-h-9'
  async function save() {
    const parsed = parseWindowDraft(draft)
    if (parsed.kind !== 'ok') {
      setError(parsed.kind === 'invalid' ? parsed.message : 'Укажите дату и время открытия и закрытия')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setPersonalWindow(homeworkId, studentId, parsed.opensAt, parsed.closesAt)
      toast.success('Работа открыта заново для ученика')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить')
      setBusy(false)
    }
  }
  return (
    <div data-testid="live-work-reopen-form" className="mt-1 flex flex-wrap items-end gap-2 rounded-xl bg-slate-50 p-3">
      <label className="flex flex-col text-xs text-graphite-600">Дата
        <input type="date" className={field} value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} />
      </label>
      <label className="flex flex-col text-xs text-graphite-600">Открывается
        <input type="time" className={field} value={draft.opens} onChange={e => setDraft(d => ({ ...d, opens: e.target.value }))} />
      </label>
      <label className="flex flex-col text-xs text-graphite-600">Закрывается
        <input type="time" className={field} value={draft.closes} onChange={e => setDraft(d => ({ ...d, closes: e.target.value }))} />
      </label>
      <button
        type="button"
        data-testid="live-work-reopen-save"
        disabled={busy}
        onClick={save}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 text-sm font-bold text-white hover:bg-primary-700 disabled:opacity-60 md:min-h-9"
      >
        {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}Открыть
      </button>
      <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-graphite-600 hover:text-graphite-900 md:min-h-9">
        Отмена
      </button>
      {error && <p className="w-full text-xs text-red-600" role="alert">{error}</p>}
    </div>
  )
}

export default LiveWorkPage
