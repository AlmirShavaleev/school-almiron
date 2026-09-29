import { useState } from 'react'
import { chartAriaLabel, formatNumber, prevDelta, type ChartPoint } from '@/lib/courseAssessments'

/**
 * §241. График пробников в блоке «Пробники» раздела курса.
 *
 * Вторичный балл ученика — сплошная линия #1f55e0, точки ≥ 8 px, последняя
 * подписана числом; средний группы — пунктир #c27a00 и только там, где
 * правило троих выполнено (иначе точки нет, и линия через неё не тянется).
 * Одна ось 0–100 (шире — только если у пробника шкала больше ста). Пара цветов
 * проверена валидатором палитры (светлый фон): контраст ≥ 3:1, различимы при
 * дальтонизме (ΔE 32). Цвет — не единственный признак: у группы пунктир и
 * легенда, у ученика — сплошная линия и подпись последней точки.
 *
 * Подсказка — на наведение, фокус с клавиатуры и нажатие (телефон). Всё, что
 * в ней, есть и без неё: в `aria-label` графика и в строках блока ниже.
 *
 * Меньше двух пробников с итогом — вместо графика одно число.
 */
export const YOU_COLOR = '#1f55e0'
export const GROUP_COLOR = '#c27a00'

const W = 340
const H = 176
const L = 32
const R = 16
const T = 22
const B = 26

export function MockScoreChart({ points }: { points: ChartPoint[] }) {
  const [active, setActive] = useState<number | null>(null)
  if (points.length === 0) return null
  if (points.length < 2) {
    const p = points[0]
    return (
      <div data-testid="mock-chart-single" className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-3xl font-extrabold leading-none text-primary-900 tabular-nums">{p.you}</span>
        <span className="text-sm text-graphite-600">
          вторичный · {p.title}
          {p.group != null && <> · средний по группе {formatNumber(p.group)}</>}
        </span>
      </div>
    )
  }

  const yMax = Math.max(100, ...points.map(p => Math.max(p.you, p.group ?? 0)))
  const plotW = W - L - R
  const plotH = H - T - B
  const x = (i: number) => L + 10 + (i * (plotW - 20)) / (points.length - 1)
  const y = (v: number) => T + plotH - (v / yMax) * plotH
  const ticks = [0, 25, 50, 75, 100].map(v => (v * yMax) / 100)

  const youPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.you).toFixed(1)}`).join(' ')
  // Пунктир группы — только между соседними точками, где средний есть.
  const groupSegs: string[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].group, b = points[i].group
    if (a != null && b != null) groupSegs.push(`M${x(i - 1).toFixed(1)},${y(a).toFixed(1)} L${x(i).toFixed(1)},${y(b).toFixed(1)}`)
  }
  const hasGroup = points.some(p => p.group != null)
  const last = points.length - 1
  const colW = (plotW - 20) / (points.length - 1)
  const tip = active != null ? points[active] : null
  const delta = active != null && active > 0 ? prevDelta(points[active].you, points[active - 1].you) : null

  return (
    // Не шире ~460 px: SVG масштабируется целиком, и на компьютере подписи
    // осей иначе вырастали бы вдвое.
    <div className="flex max-w-[460px] flex-col gap-2" data-testid="mock-chart">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite-600" data-testid="mock-chart-legend">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke={YOU_COLOR} strokeWidth="2.5" /></svg>Ты
        </span>
        {hasGroup && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" stroke={GROUP_COLOR} strokeWidth="2.5" strokeDasharray="4 3" /></svg>Средний по группе
          </span>
        )}
      </div>
      <div className="relative" onMouseLeave={() => setActive(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={chartAriaLabel(points)} data-testid="mock-chart-svg">
          <g fontFamily="Manrope, sans-serif" fontSize="10" fill="#55607a">
            {ticks.map(v => (
              <g key={v}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? '#c9d6ef' : '#edf1f9'} />
                <text x={L - 6} y={y(v) + 3} textAnchor="end">{Math.round(v)}</text>
              </g>
            ))}
            {points.map((p, i) => (
              <text key={p.id} x={x(i)} y={H - 8} textAnchor="middle">{p.date}</text>
            ))}
          </g>
          {active != null && <line x1={x(active)} x2={x(active)} y1={T} y2={T + plotH} stroke="#c9d6ef" strokeWidth="1" />}
          {groupSegs.map((d, i) => <path key={i} d={d} fill="none" stroke={GROUP_COLOR} strokeWidth="2" strokeDasharray="5 4" />)}
          {points.map((p, i) => p.group != null && (
            <circle key={`g${p.id}`} cx={x(i)} cy={y(p.group)} r="4" fill={GROUP_COLOR} stroke="#fff" strokeWidth="2" data-testid="mock-chart-group-dot" />
          ))}
          <path d={youPath} fill="none" stroke={YOU_COLOR} strokeWidth="2" strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={p.id} cx={x(i)} cy={y(p.you)} r={i === last ? 5.5 : 4.5} fill={YOU_COLOR} stroke="#fff" strokeWidth="2" data-testid="mock-chart-dot" />
          ))}
          <text x={x(last)} y={y(points[last].you) - 10} textAnchor="middle" fontFamily="Manrope, sans-serif" fontSize="11" fontWeight="700" fill="#12234a" data-testid="mock-chart-last">
            {points[last].you}
          </text>
          {points.map((p, i) => (
            <rect
              key={`hit${p.id}`}
              x={x(i) - colW / 2}
              y={T - 8}
              width={colW}
              height={plotH + 16}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.title}, ${p.date}: ты ${p.you}${p.group != null ? `, группа ${formatNumber(p.group)}` : ''}`}
              data-testid="mock-chart-hit"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
              style={{ outline: 'none', cursor: 'pointer' }}
            />
          ))}
        </svg>
        {tip && active != null && (
          <div
            role="status"
            data-testid="mock-chart-tip"
            className="pointer-events-none absolute whitespace-nowrap rounded-lg bg-graphite-900 px-2 py-1.5 text-[11.5px] leading-snug text-white shadow"
            style={{
              left: `${Math.min(Math.max((x(active) / W) * 100, 18), 82)}%`,
              top: `${(y(tip.you) / H) * 100}%`,
              transform: 'translate(-50%, -118%)',
            }}
          >
            <b className="block font-semibold">{tip.title} · {tip.date}</b>
            Ты: <b className="tabular-nums">{tip.you}</b>
            {tip.group != null && <> · группа: <span className="tabular-nums">{formatNumber(tip.group)}</span></>}
            {delta && <span className="block text-white/80">{delta}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
