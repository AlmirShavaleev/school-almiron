import { UserX, Activity, EyeOff, Filter } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  DORMANT_DAYS,
  MATERIAL_VIEWS_SINCE,
  VISITS_SINCE,
  type ViewHealth,
  type ActivityDay,
  type DormantStudent,
  type HomeworkFunnelRow,
  type UnopenedTopic,
} from '@/hooks/useSchoolAnalytics'

/**
 * Активность школы: кто пропал, заходы по дням, что не открывают, воронка ДЗ.
 *
 * «Кто пропал» стоит первым намеренно — из всех четырёх это единственный
 * экран, который подсказывает действие: кому написать сегодня. Остальное —
 * наблюдение.
 *
 * Свёрстано от узкого экрана: одна колонка, две — только с `lg`.
 */

interface SchoolActivityProps {
  dormant:     DormantStudent[]
  activity:    ActivityDay[]
  unopened:    UnopenedTopic[]
  funnel:      HomeworkFunnelRow[]
  viewHealth:  ViewHealth
  hasViewData: boolean
  loading:     boolean
  error:       string | null
}

export function SchoolActivity(props: SchoolActivityProps) {
  const { dormant, activity, unopened, funnel, viewHealth, hasViewData, loading, error } = props

  if (loading) {
    return <Shell><p className="py-6 text-center text-sm text-slate-400">Считаем активность…</p></Shell>
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="school-activity">
      <DormantBlock rows={dormant} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActivityBlock days={activity} />
        <FunnelBlock rows={funnel} />
      </div>

      <UnopenedBlock rows={unopened} hasViewData={hasViewData} health={viewHealth} />
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4">{children}</div>
}

function Head({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">{icon}</span>
        <h3 className="text-sm font-semibold text-graphite-950">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

function DormantBlock({ rows }: { rows: DormantStudent[] }) {
  return (
    <Shell>
      <Head
        icon={<UserX size={16} />}
        title={`Кто пропал (${DORMANT_DAYS}+ дней)`}
        hint={`Последняя активность — заход, сдача ДЗ или попытка теста. Учёт заходов ведётся с ${formatDay(VISITS_SINCE)}.`}
      />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
          Пропавших нет — все ученики курсов заходили или сдавали работы.
        </p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {rows.map(row => (
            <li key={row.student_id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <div className="font-medium text-graphite-950">{row.full_name}</div>
                <div className="truncate text-xs text-slate-500">{row.course_titles}</div>
              </div>
              <span className={cn(
                'shrink-0 self-start rounded-full px-2 py-0.5 text-xs font-semibold',
                row.never_active ? 'bg-slate-100 text-slate-600' : 'bg-red-100 text-red-700',
              )}>
                {row.never_active
                  ? 'ни разу не заходил'
                  : `молчит ${row.days_silent} дн. · ${formatDay(row.last_active)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function ActivityBlock({ days }: { days: ActivityDay[] }) {
  const max = days.reduce((m, d) => Math.max(m, d.people), 0)

  return (
    <Shell>
      <Head icon={<Activity size={16} />} title="Заходы по дням" hint="За последние 30 дней" />
      {max === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">За месяц заходов не было.</p>
      ) : (
        // Столбики обычным флексом: ради одного графика тянуть тяжёлую
        // отрисовку незачем, а нули должны рисоваться нулями — иначе провал
        // выглядит как отсутствие данных.
        <div className="flex h-24 items-end gap-[2px]" role="img" aria-label="Заходы по дням за 30 дней">
          {days.map(d => (
            <div
              key={d.day}
              title={`${formatDay(d.day)} — ${d.people}`}
              className={cn(
                'flex-1 rounded-t-sm',
                d.people > 0 ? 'bg-primary-500' : 'bg-slate-100',
              )}
              style={{ height: `${d.people > 0 ? Math.max((d.people / max) * 100, 8) : 3}%` }}
            />
          ))}
        </div>
      )}
    </Shell>
  )
}

function FunnelBlock({ rows }: { rows: HomeworkFunnelRow[] }) {
  return (
    <Shell>
      <Head
        icon={<Filter size={16} />}
        title="Воронка ДЗ"
        hint="Ожидалось → сдано → принято. Считается работами, а не попытками."
      />
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Курсов пока нет.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(row => (
            <li key={row.course_id}>
              <div className="mb-1 truncate text-sm font-medium text-graphite-950">{row.course_title}</div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>{row.expected}</span>
                <Bar value={row.expected} max={row.expected} tone="bg-slate-200" />
                <span>{row.submitted}</span>
                <Bar value={row.submitted} max={row.expected} tone="bg-primary-400" />
                <span>{row.accepted}</span>
                <Bar value={row.accepted} max={row.expected} tone="bg-green-500" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-1.5 flex-1 rounded-full bg-slate-100">
      <div className={cn('h-1.5 rounded-full', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function UnopenedBlock({
  rows, hasViewData, health,
}: {
  rows: UnopenedTopic[]
  hasViewData: boolean
  health: ViewHealth
}) {
  return (
    <Shell>
      <Head
        icon={<EyeOff size={16} />}
        title="Что не открывают"
        hint="Темы, материалы которых не открыл никто"
      />
      {!hasViewData ? (
        // Пока просмотры не логируются, «не открыто» — это все материалы
        // разом. Показывать их значило бы выдать артефакт за ответ.
        <p className="py-4 text-center text-sm text-slate-400">
          Данных пока нет: учёт открытий материалов только заведён и накапливается.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">Все материалы кто-нибудь да открыл.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {rows.map(row => (
            <li key={row.topic_id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate font-medium text-graphite-950">{row.topic_title}</div>
                <div className="truncate text-xs text-slate-500">{row.course_title}</div>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {row.unopened} из {row.total_items}
              </span>
            </li>
          ))}
        </ul>
      )}

      <ViewHealthLine health={health} />
    </Shell>
  )
}

/**
 * Сторож врезки учёта.
 *
 * Клиентский вызов `record_material_view` намеренно глушит любую ошибку —
 * подсчёт не должен мешать ученику открыть файл. Значит разъехавшийся
 * контракт (имя функции, параметр, права) не скажет о себе ничего: аналитика
 * просто перестанет наполняться. Эта строка и есть единственный видимый
 * признак — ноль в ней означает «за неделю не записалось ни одного открытия».
 */
function ViewHealthLine({ health }: { health: ViewHealth }) {
  const silent = health.views_7d === 0
  return (
    <p
      data-testid="view-health"
      className={cn(
        'mt-3 border-t border-slate-100 pt-2 text-xs',
        silent ? 'text-amber-700' : 'text-slate-400',
      )}
    >
      Записано открытий за 7 дней: <b>{health.views_7d}</b>
      {health.views_total > 0 && <> · всего {health.views_total}</>}
      {' · '}учёт открытий ведётся с {formatDay(MATERIAL_VIEWS_SINCE)}
      {silent && <> · ноль здесь означает, что учёт не пишется</>}
    </p>
  )
}

function formatDay(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
