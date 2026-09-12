import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Clock, Minus,
  Radio, Send, UserPlus, Users,
} from 'lucide-react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cn } from '@/utils/cn'
import { useLivePulse } from '@/hooks/useLivePulse'
import { useOnlinePeople } from '@/hooks/useSchoolPresence'
import { LiveCard } from '@/components/admin/LiveCard'
import {
  FEED_LABELS, formatAgo, formatDay, formatHour, peakHour, reachShare,
  totalHourEvents, weekChange, weekDirection,
  type DayPoint, type FeedEvent, type HourPoint, type WeekOverWeek,
} from '@/lib/livePulse'
import { ROLE_LABELS } from '@/utils/format'

/**
 * Вкладка «Сейчас» — живая панель школы.
 *
 * Тринадцать блоков, выбранных владельцем; список закрытый. Всё, чего в нём
 * нет, обсуждено и осознанно отложено — добавлять сюда «раз уж всё равно
 * рисуем» нельзя.
 *
 * Два решения владельца пронизывают весь экран:
 *
 * 1. **Только факт присутствия.** Показываем, кто на платформе, и НЕ
 *    показываем, на каком экране человек находится. Истории перемещений не
 *    существует вовсе — её никто не пишет.
 * 2. **Не рисовать красоту поверх пустоты.** День без сдач — нулевой столбик,
 *    а не пропуск; пустая школа — слова «сейчас никого», а не пустые рамки.
 *
 * Числа §107 (очередь проверки, сдано сегодня, пропавшие) приходят СВЕРХУ
 * пропсами: они уже загружены страницей, и второй счётчик тех же величин
 * развёл бы два ответа на один вопрос.
 *
 * Присутствие панель только ЧИТАЕТ, опросом раз в 15 секунд. Отметки ставит
 * `SchoolPresencePublisher`, смонтированный на всё защищённое поддерево в
 * `AppRoutes`: отметиться должны все вошедшие, иначе «кто сейчас на
 * платформе» покажет одних админов. Канала Realtime здесь больше нет — почему,
 * написано в `@/lib/schoolPresence`.
 */

export interface LiveNowProps {
  /** `admin_school_stats().homework_pending` — блок 1. */
  pendingReview: number | null
  /** `admin_school_stats().homework_submitted_today` — блок 3. */
  submittedToday: number | null
  /**
   * `school_dormant_students(7)` — блок 22, уже загружен страницей.
   *
   * `student_id` здесь не для красоты: карточка ученика живёт по адресу
   * `/students/:id`, и `:id` — это ИМЕННО student_id. Передать туда profile_id
   * значит открыть пустую карточку.
   */
  dormant: Array<{ student_id: string; profile_id: string; full_name: string; days_silent: number | null }>
  /** Профили школы — чтобы подставить имя к `profileId` из канала присутствия. */
  profiles: Array<{ id: string; full_name: string; role: string }>
  /** Ошибка школьной RPC, если она уже случилась на уровне страницы. */
  schoolError?: string | null
}

/** Уважение к `prefers-reduced-motion`: анимации графиков выключаются целиком. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    // Safari до 14 не знает addEventListener у MediaQueryList.
    if (query.addEventListener) {
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    query.addListener(onChange)
    return () => query.removeListener(onChange)
  }, [])

  return reduced
}

export function LiveNow(props: LiveNowProps) {
  const { pendingReview, submittedToday, dormant, profiles, schoolError } = props
  const navigate = useNavigate()
  const { pulse, feed, loading, error, liveFeed, reload } = useLivePulse()
  const { people, ok: presenceOk } = useOnlinePeople()
  const reducedMotion = usePrefersReducedMotion()

  // Имя к идентификатору. В канале присутствия имён нет намеренно — подставляем
  // из уже загруженного списка профилей.
  const nameById = useMemo(() => {
    const map = new Map<string, { name: string; role: string }>()
    for (const p of profiles) map.set(p.id, { name: p.full_name, role: p.role })
    return map
  }, [profiles])

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
        Загружаем живую панель…
      </div>
    )
  }

  if (error) {
    return (
      <div
        data-testid="live-now-error"
        role="alert"
        className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
      >
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="live-now">
      {/* Четыре карточки владельца. Слой поверх вкладки: лента, присутствие и
          графики §148 ниже остаются как были. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="live-cards">
        <LiveCard
          title="Заходы на платформу"
          points={pulse?.visitsDaily ?? []}
          kind="flow"
          tone="more-is-good"
          // Точка живая, и число под ней — НАСТОЯЩЕЕ присутствие (§148), а не
          // заходы за сегодня: это разные величины, и подпись обязана
          // совпадать с источником.
          statusText={presenceOk ? `${people.length} сейчас на платформе` : 'присутствие не прочиталось'}
          live={presenceOk}
          color="#6366f1"
          animate={!reducedMotion}
          testId="card-visits"
        />
        <LiveCard
          title="Сдачи домашних работ"
          points={pulse?.submitsDaily ?? []}
          kind="flow"
          tone="more-is-good"
          statusText={`сегодня: ${lastValue(pulse?.submitsDaily)}`}
          color="#10b981"
          onOpen={() => navigate('/inbox')}
          openLabel="Открыть очередь проверки"
          animate={!reducedMotion}
          testId="card-submits"
        />
        <LiveCard
          title="Очередь проверки"
          points={pulse?.queueDaily ?? []}
          // Уровень, а не поток: сумма очереди по дням не значит ничего.
          kind="level"
          // Рост очереди — ПЛОХО. Зелёная стрелка вверх здесь была бы прямой
          // дезинформацией.
          tone="more-is-bad"
          statusText="работ ждут разбора"
          color="#f59e0b"
          onOpen={() => navigate('/inbox')}
          openLabel="Открыть очередь проверки"
          animate={!reducedMotion}
          testId="card-queue"
        />
        <LiveCard
          title="Тема пройдена"
          points={pulse?.marksDaily ?? []}
          kind="flow"
          tone="more-is-good"
          // Строгое определение, то же, что в кабинете ученика: обе отмечаемые
          // группы плюс принятое ДЗ. Считать по отметкам рубрик значило бы
          // разойтись с собственной подписью.
          statusText="строго: обе группы и принятое ДЗ"
          color="#8b5cf6"
          animate={!reducedMotion}
          testId="card-marks"
        />
      </div>

      <OnlineBlock
        people={people}
        ok={presenceOk}
        nameById={nameById}
        onRefresh={reload}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ActionStat
          title="Ждут проверки"
          value={schoolError ? '—' : String(pendingReview ?? 0)}
          onClick={() => navigate('/homework-queue')}
        />
        <ActionStat
          title="Сдано сегодня"
          value={schoolError ? '—' : String(submittedToday ?? 0)}
        />
        <ActionStat
          title="Заходили за 7 дней"
          value={reachLabel(pulse?.reach.active7d ?? 0, pulse?.reach.enrolled ?? 0)}
          hint={reachHint(pulse?.reach.active7d ?? 0, pulse?.reach.enrolled ?? 0)}
        />
        <ActionStat
          title="Дней с заходом на ученика"
          value={String(pulse?.visitDaysPerStudent ?? 0)}
          hint="за 7 дней; больше одного захода в день не считается"
        />
      </div>

      {pulse && <WeekBlock week={pulse.week} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartBlock
          title="Заходы по дням"
          hint="За 14 дней. День без заходов — нулевой столбик, а не пропуск."
          points={pulse?.visitsDaily ?? []}
          color="#6366f1"
          animate={!reducedMotion}
          testId="live-visits-chart"
        />
        <ChartBlock
          title="Сдачи по дням"
          hint="За 14 дней."
          points={pulse?.submitsDaily ?? []}
          color="#10b981"
          animate={!reducedMotion}
          testId="live-submits-chart"
        />
      </div>

      <HourBlock hours={pulse?.hourly ?? []} animate={!reducedMotion} />

      <FeedBlock events={feed} live={liveFeed} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <PeopleList
          icon={<Clock size={16} />}
          title={`Не заходили 7 дней — ${dormant.length}`}
          hint="Имена, а не число: число ни к чему не побуждает."
          testId="live-dormant"
          rows={dormant.map(d => ({
            id: d.student_id,
            name: d.full_name,
            note: d.days_silent === null ? 'ни разу не заходил' : `молчит ${d.days_silent} дн.`,
          }))}
          empty="Все заходили за последнюю неделю."
          onOpen={id => navigate(`/students/${id}`)}
        />
        <PeopleList
          icon={<Send size={16} />}
          title={`Без Telegram — ${pulse?.noTelegram.length ?? 0}`}
          hint="Уведомления о работах до них не доходят."
          testId="live-no-telegram"
          rows={(pulse?.noTelegram ?? []).map(s => ({ id: s.studentId, name: s.fullName }))}
          empty="У всех учеников привязан Telegram."
          onOpen={id => navigate(`/students/${id}`)}
        />
        <PeopleList
          icon={<UserPlus size={16} />}
          title={`Новые за неделю — ${pulse?.newStudents.length ?? 0}`}
          hint="Появились в школе за последние 7 дней."
          testId="live-new-students"
          rows={(pulse?.newStudents ?? []).map(s => ({
            id: s.studentId, name: s.fullName, note: formatAgo(s.createdAt),
          }))}
          empty="Новых учеников за неделю не появилось."
          onOpen={id => navigate(`/students/${id}`)}
        />
      </div>
    </div>
  )
}

// ── Присутствие ────────────────────────────────────────────────────────────

function OnlineBlock({
  people, ok, nameById, onRefresh,
}: {
  people: Array<{ profileId: string; role: string }>
  /** Список прочитался. Ложь — это НЕ «никого нет», и экран их разводит. */
  ok: boolean
  nameById: Map<string, { name: string; role: string }>
  onRefresh: () => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="live-online">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio size={16} className={cn(ok ? 'text-green-600' : 'text-slate-300')} />
            <h3 className="text-sm font-semibold text-graphite-950">Сейчас в школе</h3>
          </div>
          {/* Оговорка про охват присутствия — до числа, а не после.
              Подпись обязана совпадать с окном `school_presence_online`: это
              «занимался последние полчаса», а не «вкладка сейчас поверх
              остальных». Ученик, читающий конспект в соседней вкладке,
              присутствует — ради этого §165 и делался. */}
          <p className="mt-1 text-xs text-slate-400">
            Активны за последние 30 минут. Открытый в соседней вкладке конспект тоже
            считается занятием. На каком экране человек находится — не показываем.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="shrink-0 rounded-xl px-2 py-1 text-xs text-slate-500 transition-colors hover:text-graphite-900"
        >
          Обновить
        </button>
      </div>

      {!ok ? (
        // Отказ чтения и пустая школа выглядят одинаково — пустым списком.
        // Поэтому состояния разведены словами.
        <p className="mt-3 text-sm text-slate-400" data-testid="live-online-offline">
          Список присутствия не прочитался. Числа ниже это не затрагивает.
        </p>
      ) : people.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400" data-testid="live-online-empty">
          Сейчас никого.
        </p>
      ) : (
        <>
          <div className="mt-2 text-3xl font-bold text-graphite-950" data-testid="live-online-count">
            {people.length}
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="live-online-list">
            {people.map(person => {
              const known = nameById.get(person.profileId)
              return (
                <li
                  key={person.profileId}
                  className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-graphite-900"
                >
                  {/* Имя подставляется здесь: в канале его нет. Незнакомый
                      профиль показываем ролью, а не пустой строкой. */}
                  {known?.name || 'Без имени'}
                  <span className="ml-1 text-slate-400">
                    {ROLE_LABELS[known?.role || person.role] || known?.role || person.role}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

// ── Числа с действием ──────────────────────────────────────────────────────

function ActionStat({
  title, value, hint, onClick,
}: {
  title: string
  value: string
  hint?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="text-2xl font-bold text-graphite-950">{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{title}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-tight text-slate-400">{hint}</div>}
    </>
  )
  if (!onClick) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-4">{body}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-primary-300"
    >
      {body}
      <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-primary-600">
        Открыть <ArrowRight size={11} />
      </span>
    </button>
  )
}

function reachLabel(active: number, enrolled: number): string {
  const share = reachShare(active, enrolled)
  if (share === null) return '—'
  return `${active} из ${enrolled}`
}

function reachHint(active: number, enrolled: number): string {
  const share = reachShare(active, enrolled)
  if (share === null) return 'зачисленных учеников пока нет'
  return `${Math.round(share * 100)} % зачисленных`
}

// ── Неделя к неделе ────────────────────────────────────────────────────────

function WeekBlock({ week }: { week: WeekOverWeek }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="live-week">
      <WeekCard
        title="Заходы: неделя к неделе"
        current={week.visitsThis}
        previous={week.visitsPrev}
      />
      <WeekCard
        title="Сдачи: неделя к неделе"
        current={week.submitsThis}
        previous={week.submitsPrev}
      />
    </div>
  )
}

function WeekCard({ title, current, previous }: { title: string; current: number; previous: number }) {
  const direction = weekDirection(current, previous)
  const change = weekChange(current, previous)
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{title}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-graphite-950">{current}</span>
        <span className="text-sm text-slate-400">против {previous}</span>
      </div>
      <div
        className={cn(
          'mt-1 inline-flex items-center gap-1 text-xs',
          direction === 'up' && 'text-green-600',
          direction === 'down' && 'text-orange-600',
          direction === 'flat' && 'text-slate-400',
        )}
      >
        <Icon size={13} />
        {/* Рост с нуля процентом не выражается: +2300 % — это шум, а не число. */}
        {change === null
          ? (direction === 'flat' ? 'без изменений' : 'на прошлой неделе не было')
          : `${change > 0 ? '+' : ''}${Math.round(change * 100)} %`}
      </div>
    </div>
  )
}

// ── Графики ────────────────────────────────────────────────────────────────

function Shell({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={testId}>
      {children}
    </div>
  )
}

function Head({ icon, title, hint }: { icon?: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        {icon && <span className="text-slate-500">{icon}</span>}
        <h3 className="text-sm font-semibold text-graphite-950">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

function ChartBlock({
  title, hint, points, color, animate, testId,
}: {
  title: string
  hint: string
  points: DayPoint[]
  color: string
  animate: boolean
  testId: string
}) {
  const data = points.map(p => ({ label: formatDay(p.day), value: p.value }))
  const total = data.reduce((sum, d) => sum + d.value, 0)

  return (
    <Shell testId={testId}>
      <Head title={title} hint={hint} />
      {data.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Данных за период нет.</p>
      ) : (
        <>
          {/* Ноль за весь период — это ответ, а не поломка. Говорим словами и
              всё равно рисуем ряд: пустая рамка выглядела бы как сбой. */}
          {total === 0 && (
            <p className="mb-2 text-xs text-slate-400">За две недели ни одного события.</p>
          )}
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={28} />
              <Tooltip cursor={{ fill: '#f8fafc' }} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="value" name="сколько" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={animate} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Shell>
  )
}

function HourBlock({ hours, animate }: { hours: HourPoint[]; animate: boolean }) {
  const peak = peakHour(hours)
  const total = totalHourEvents(hours)
  const data = hours.map(h => ({ label: formatHour(h.hour), value: h.events }))

  return (
    <Shell testId="live-hours">
      <Head
        icon={<Activity size={16} />}
        title="Когда школа учится"
        // Честная подпись — прямое требование вводной. Заходы сюда не годятся:
        // в них времени суток нет вовсе, одна отметка на человека в сутки.
        hint="По учебным событиям за 30 дней: сдачи, разборы, отметки тем. Заходы сюда не входят — в них времени суток нет."
      />
      {total === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400" data-testid="live-hours-empty">
          За 30 дней учебных событий не было — час пик показывать не из чего.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500" data-testid="live-hours-peak">
            {peak
              ? `Чаще всего — в ${formatHour(peak.hour)}. Всего событий: ${total}.`
              : `Всего событий: ${total}.`}
          </p>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="label" interval={2} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={28} />
              <Tooltip cursor={{ fill: '#f8fafc' }} labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="value" name="событий" fill="#f59e0b" radius={[3, 3, 0, 0]} isAnimationActive={animate} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Shell>
  )
}

// ── Лента ──────────────────────────────────────────────────────────────────

function FeedBlock({ events, live }: { events: FeedEvent[]; live: boolean }) {
  return (
    <Shell testId="live-feed">
      <Head
        icon={<Users size={16} />}
        title="Что происходит"
        hint="Учебные события: сдачи, разборы, отметки тем, зачисления. Это то, что персонал видит и так."
      />
      {!live && (
        <p className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500" data-testid="live-feed-static">
          Лента не обновляется сама — подписка не поднялась. Нажмите «Обновить» вверху.
        </p>
      )}
      {events.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400" data-testid="live-feed-empty">
          Пока ничего не произошло.
        </p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {events.map((event, index) => (
            <li
              key={`${event.kind}-${event.at}-${index}`}
              className="flex items-baseline justify-between gap-3 py-2"
            >
              <span className="min-w-0 text-sm text-graphite-900">
                <span className="font-medium">{event.actorName}</span>{' '}
                <span className="text-slate-500">{FEED_LABELS[event.kind]}</span>{' '}
                <span className="text-slate-400">· {event.detail}</span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{formatAgo(event.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

// ── Списки имён ────────────────────────────────────────────────────────────

function PeopleList({
  icon, title, hint, rows, empty, testId, onOpen,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  rows: Array<{ id: string; name: string; note?: string }>
  empty: string
  testId: string
  onOpen: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  // Списки бывают длинными (26 без Telegram, 27 новых за неделю). Показываем
  // первые пять, остальное — по кнопке: три экрана имён никто не читает.
  const visible = expanded ? rows : rows.slice(0, 5)

  return (
    <Shell testId={testId}>
      <Head icon={icon} title={title} hint={hint} />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">{empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-slate-50">
            {visible.map(row => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="flex w-full items-baseline justify-between gap-2 py-2 text-left transition-colors hover:text-primary-700"
                >
                  <span className="min-w-0 truncate text-sm text-graphite-900">{row.name}</span>
                  {row.note && <span className="shrink-0 text-xs text-slate-400">{row.note}</span>}
                </button>
              </li>
            ))}
          </ul>
          {rows.length > 5 && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="mt-2 text-xs text-primary-600 hover:text-primary-700"
            >
              {expanded ? 'Свернуть' : `Показать всех — ${rows.length}`}
            </button>
          )}
        </>
      )}
    </Shell>
  )
}

/** Значение последнего дня ряда — «сегодня» в подписи карточки. */
function lastValue(points?: Array<{ value: number }>): number {
  if (!points || points.length === 0) return 0
  return points[points.length - 1]?.value ?? 0
}
