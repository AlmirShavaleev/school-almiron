import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/utils/cn'
import {
  milestoneView, milestonesText, pointsWord, ZONE_LABEL, zoneRangeText, zoneRule,
  type CatalogRules, type CatalogZone, type NumberState,
} from '@/lib/catalogRewards'

/**
 * §256. Номер раздела у ученика: метка зоны («№6 — зона роста: +5 за
 * задачу»), вехи 10/20/30 с полоской и кнопка «Как начисляются баллы»,
 * которая раскрывает таблицу наград. Зона и все числа — из ответа базы
 * (`catalog_practice_state`), своих порогов здесь нет.
 *
 * Таблица — по кнопке, а не всегда на странице: она нужна один раз, чтобы
 * понять правило, а задачам не должна мешать (решение §256).
 */
export const ZONE_CHIP: Record<CatalogZone, string> = {
  growth: 'bg-gold-100 text-gold-800',
  progress: 'bg-primary-50 text-primary-700',
  confident: 'bg-verdict-ok-tint text-verdict-ok-ink',
}

export function CatalogNumberProgress({ number, rules, className }: {
  number: NumberState
  rules: CatalogRules
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const tableId = useId()
  const rule = zoneRule(rules, number.zone)
  const mv = milestoneView(rule, number.solved)

  return (
    <div data-testid="catalog-number-progress" data-zone={number.zone} className={cn('grid gap-2.5 rounded-2xl bg-graphite-50 p-3 ring-1 ring-graphite-200', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="catalog-zone-chip" className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-extrabold', ZONE_CHIP[number.zone])}>
          №{number.n} — {ZONE_LABEL[number.zone]}{rule ? `: +${rule.perTask} за задачу` : ''}
        </span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={tableId}
          data-testid="catalog-rewards-toggle"
          onClick={() => setOpen(v => !v)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          Как начисляются баллы
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      </div>

      {rule && rule.milestones.length > 0 && (
        <div className="grid gap-1.5" data-testid="catalog-milestones">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <b className="text-graphite-900">Верно по №{number.n}</b>
            <span className="text-graphite-600">{mv.text}</span>
          </div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-white"
            role="progressbar"
            aria-label={`Верно по №${number.n}`}
            aria-valuemin={0}
            aria-valuemax={mv.next ?? number.solved}
            aria-valuenow={number.solved}
          >
            <i className="block h-full rounded-full bg-gold-400 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round(mv.ratio * 100)}%` }} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {mv.ticks.map(t => (
              <span
                key={t.at}
                data-reached={t.reached || undefined}
                className={cn('rounded-lg px-1 py-1 text-center text-[11px] font-bold', t.reached ? 'bg-gold-100 text-gold-800' : 'bg-white text-graphite-500')}
              >
                {t.at} задач · +{t.bonus}
              </span>
            ))}
          </div>
        </div>
      )}

      {open && <CatalogRewardsTable id={tableId} rules={rules} />}
    </div>
  )
}

/** «Как начисляются баллы школы за каталог» — из правил базы. */
export function CatalogRewardsTable({ rules, id }: { rules: CatalogRules; id?: string }) {
  return (
    <div id={id} data-testid="catalog-rewards-table" className="grid gap-2 rounded-xl bg-white p-3 ring-1 ring-graphite-200">
      <h3 className="text-sm font-extrabold text-graphite-950">Как начисляются баллы школы за каталог</h3>
      <p className="text-xs text-graphite-500">
        Зависит от того, насколько уверенно вы уже решаете этот номер: больше всего — за то, что ещё не получается.
        Зона считается по вашим решениям номера за {rules.windowDays} дней — ДЗ, тесты, пробники и каталог.
      </p>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] font-extrabold uppercase tracking-[0.05em] text-graphite-400">
              <th className="border-b border-graphite-200 py-1.5 pr-2 font-extrabold">Номер у вас</th>
              <th className="border-b border-graphite-200 px-2 py-1.5 font-extrabold">За&nbsp;задачу</th>
              <th className="border-b border-graphite-200 py-1.5 pl-2 font-extrabold">За 10 / 20 / 30 верных</th>
            </tr>
          </thead>
          <tbody>
            {rules.zones.map(z => (
              <tr key={z.key} data-zone={z.key}>
                <td className="border-b border-graphite-100 py-2 pr-2 align-top">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-extrabold', ZONE_CHIP[z.key])}>{ZONE_LABEL[z.key]}</span>
                  <div className="mt-0.5 text-xs text-graphite-500">{zoneRangeText(rules, z.key)}</div>
                </td>
                <td className="whitespace-nowrap border-b border-graphite-100 px-2 py-2 align-top font-extrabold tabular-nums text-graphite-900">+{z.perTask}</td>
                <td className="border-b border-graphite-100 py-2 pl-2 align-top font-extrabold tabular-nums text-graphite-900">{milestonesText(z)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-graphite-500">
        Плюс: задача дня +{rules.dailyTask} {pointsWord(rules.dailyTask)}, цель недели +{rules.weeklyGoal}.
        Задача с ответом, открытым до проверки, и «Отметить выполненной» — 0.
      </p>
    </div>
  )
}
