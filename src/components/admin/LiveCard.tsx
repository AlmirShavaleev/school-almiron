import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts'
import { cn } from '@/utils/cn'
import {
  changeMood, flowSummary, levelSummary, splitUnfinishedTail,
  weekChange, weekDirection,
  type CardTone, type DayPoint,
} from '@/lib/livePulse'

/**
 * Карточка с графиком для вкладки «Сейчас».
 *
 * Устройство взято с карточки аналитики Vercel, которую показал владелец, —
 * именно устройство, а не картинка: тема наша, светлая, чтобы «Сейчас» не
 * выглядела чужой среди остальных шести вкладок.
 *
 * Что составляет карточку:
 *   • одно крупное число сверху, без соседей;
 *   • бейдж изменения к прошлой неделе — цветом ПО СМЫСЛУ, а не по знаку;
 *   • строка состояния под ним;
 *   • площадь с мягкой заливкой: без сетки, без осей, без легенды;
 *   • последний отрезок пунктиром — период ещё не закончился;
 *   • стрелка в угол: карточка — вход в подробности, а не тупик (правило §147
 *     «числа остаются ссылками туда, где с ними можно что-то сделать»).
 */

export interface LiveCardProps {
  title: string
  /** Ряд по дням. Последняя точка — сегодняшний, ещё не прожитый день. */
  points: DayPoint[]
  /**
   * ПОТОК складывается за неделю (заходы, сдачи, пройденные темы), УРОВЕНЬ
   * берётся на сегодня (очередь проверки). Сумма очереди по дням не значила бы
   * ничего: работа, ждавшая три дня, вошла бы в неё трижды.
   */
  kind: 'flow' | 'level'
  tone: CardTone
  /** Строка под числом: «12 сейчас на платформе», «сегодня: 3». */
  statusText: string
  /** Точка у строки состояния — только там, где состояние действительно живое. */
  live?: boolean
  color: string
  onOpen?: () => void
  openLabel?: string
  animate: boolean
  testId: string
}

export function LiveCard(props: LiveCardProps) {
  const {
    title, points, kind, tone, statusText, live, color,
    onOpen, openLabel, animate, testId,
  } = props

  const summary = kind === 'flow' ? flowSummary(points) : levelSummary(points)
  const direction = weekDirection(summary.current, summary.previous)
  const change = weekChange(summary.current, summary.previous)
  const mood = changeMood(direction, tone)
  const data = splitUnfinishedTail(points)

  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4"
      data-testid={testId}
    >
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={openLabel ?? `Открыть: ${title}`}
          className="absolute right-3 top-3 rounded-lg p-1 text-slate-300 transition-colors hover:text-primary-600"
        >
          <ArrowRight size={15} />
        </button>
      )}

      <div className="text-xs text-slate-500">{title}</div>

      {/* Число и бейдж в одной строке и НЕ переносятся: на 390 px перенос
          разрывал бы величину и её изменение на две строки. */}
      <div className="mt-1 flex flex-nowrap items-baseline gap-2">
        <span className="text-3xl font-bold leading-none text-graphite-950" data-testid={`${testId}-value`}>
          {summary.current}
        </span>
        <span
          data-testid={`${testId}-badge`}
          data-mood={mood}
          className={cn(
            'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
            mood === 'good' && 'bg-green-50 text-green-700',
            mood === 'bad'  && 'bg-orange-50 text-orange-700',
            mood === 'flat' && 'bg-slate-100 text-slate-500',
          )}
        >
          <Icon size={11} />
          {/* Три случая, и все три — словами или числом, но не пополам:
              • ничего не изменилось — «ровно», а не «0 %»: ноль процентов
                читается как измеренное изменение, хотя изменения не было;
              • прошлый период был нулевым — «с нуля»: +2300 % это шум, а не
                число (решено в §148, функция та же, вторая не заводится);
              • иначе — проценты. */}
          {direction === 'flat'
            ? 'ровно'
            : change === null
              ? 'с нуля'
              : `${change > 0 ? '+' : ''}${Math.round(change * 100)} %`}
        </span>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
        {live && (
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-green-500"
            data-testid={`${testId}-dot`}
          />
        )}
        <span className="truncate">{statusText}</span>
      </div>

      <div className="-mx-4 -mb-4 mt-3">
        {data.length === 0 ? (
          <p className="px-4 pb-4 text-xs text-slate-400">Данных за период нет.</p>
        ) : (
          <ResponsiveContainer width="100%" height={64}>
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`fill-${testId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                cursor={false}
                labelFormatter={(label: unknown) => formatDayLabel(String(label ?? ''))}
                formatter={(value: unknown, _name: unknown, item: unknown) => [
                  Number(value ?? 0),
                  // Подсказка честно объясняет пунктир, а не оставляет его
                  // загадкой: неполный день иначе читается как провал.
                  (item as { dataKey?: string } | null)?.dataKey === 'dashed'
                    ? 'день ещё идёт'
                    : 'за день',
                ]}
                contentStyle={{ fontSize: 12 }}
              />
              {/* Завершённые дни — сплошной линией. */}
              <Area
                type="monotone"
                dataKey="solid"
                stroke={color}
                strokeWidth={2}
                fill={`url(#fill-${testId})`}
                isAnimationActive={animate}
                connectNulls={false}
                dot={false}
              />
              {/* Незавершённый хвост — пунктиром, без заливки: заливка под
                  неполным днём зрительно досчитывала бы его до конца. */}
              <Area
                type="monotone"
                dataKey="dashed"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="3 3"
                fill="none"
                isAnimationActive={animate}
                connectNulls={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}
