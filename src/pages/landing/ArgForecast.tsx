import { animate, motion, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { ArgHead } from './ArgHead'
import { Reveal } from './motion'
import { EASE, useAnim } from './anim'
import { Icon3D } from './Icon3D'
import type { Msg } from './Chat'
import type { IconName } from './icons'

const CHAT: Msg[] = [
  { text: 'Каждая решённая задача из каталога, каждое ДЗ и пробник влияют на прогноз. Умные ИИ-алгоритмы анализируют твои результаты и предсказывают, сколько примерно ты наберёшь — и что подтянуть.' },
  { text: <>А раз в месяц — полный <b>пробник ЕГЭ</b>, чтобы видеть рост своими глазами.</> },
]

/** Условные цифры примера (подпись «Цифры условные» под ними не убирать). */
const INPUTS: Array<[IconName, number, string]> = [
  ['bank', 412, 'задач решено в каталоге'],
  ['autocheck', 36, 'домашних заданий сдано'],
  ['mock', 5, 'пробников написано'],
]
const FORECAST = 84

/** Счётчик от 0 до `to`, когда `run`. */
function Count({ to, run, anim }: { to: number; run: boolean; anim: boolean }) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!anim || !run) return
    return animate(0, to, { duration: 1.4, ease: EASE, onUpdate: x => setV(Math.round(x)) }).stop
  }, [anim, run, to])
  return <>{anim ? v : to}</>
}

function Inputs() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const run = useInView(ref, { once: true, amount: 0.4 }) || !anim
  return (
    <Reveal className="card inputs">
      <div ref={ref} style={{ display: 'contents' }}>
        {INPUTS.map(([ic, n, t], i) => (
          <motion.div
            key={t}
            className="inp-row"
            initial={anim ? { opacity: 0, x: -20 } : false}
            animate={run ? { opacity: 1, x: 0 } : undefined}
            transition={{ duration: 0.4, delay: i * 0.15 }}
          >
            <Icon3D name={ic} size={52} />
            <div><b><Count to={n} run={run} anim={anim} /></b><small>{t}</small></div>
          </motion.div>
        ))}
        <div className="brain">
          <span className="dot" aria-hidden="true" />
          <div><strong>ИИ-прогноз</strong><small>подтянуть: электростатика</small></div>
          <span className="res"><Count to={FORECAST} run={run} anim={anim} /> б.</span>
        </div>
        <p className="foot">Пример. Цифры условные, прогноз — оценка, а не гарантия.</p>
      </div>
    </Reveal>
  )
}

/* График пробников — геометрия прототипа (viewBox 640×330). */
const DATA: Array<[string, number]> = [['окт', 48], ['ноя', 55], ['дек', 61], ['янв', 66], ['фев', 72], ['мар', 79], ['апр', 85], ['май', 91]]
const W = 640, H = 330, L = 44, R = 20, T = 24, B = 40, YMIN = 40, YMAX = 100, GOAL = 90
const X = (i: number) => L + (i * (W - L - R)) / (DATA.length - 1)
const Y = (v: number) => T + ((YMAX - v) * (H - T - B)) / (YMAX - YMIN)
const LINE = DATA.map(([, v], i) => {
  if (!i) return `M${X(0)} ${Y(v)}`
  const px = X(i - 1), py = Y(DATA[i - 1][1]), x = X(i), cx = (px + x) / 2
  return `C${cx} ${py},${cx} ${Y(v)},${x} ${Y(v)}`
}).join(' ')
const AREA = `${LINE} L${X(DATA.length - 1)} ${H - B} L${X(0)} ${H - B} Z`

function Chart() {
  const anim = useAnim()
  const ref = useRef<SVGSVGElement>(null)
  const run = useInView(ref, { once: true, amount: 0.4 }) || !anim
  const last = DATA.length - 1
  return (
    <Reveal className="card chart">
      <div className="chart-top"><h3>Пробник каждый месяц</h3><span className="tag t-or">цель — 90+</span></div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Пример: рост баллов за пробники с октября по май — с 48 до 91, цель 90">
        <defs>
          <linearGradient id="lnd-ga" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2F5BEA" stopOpacity=".28" /><stop offset="1" stopColor="#2F5BEA" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="c-grid">{[40, 60, 80, 100].map(v => <line key={v} x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} />)}</g>
        <g className="c-ax">
          {[40, 60, 80, 100].map(v => <text key={v} x={L - 10} y={Y(v) + 4} textAnchor="end">{v}</text>)}
          {DATA.map(([m], i) => <text key={m} x={X(i)} y={H - 12} textAnchor="middle">{m}</text>)}
        </g>
        <line className="c-goal" x1={L} x2={W - R} y1={Y(GOAL)} y2={Y(GOAL)} />
        <text className="c-goal-t" x={L + 6} y={Y(GOAL) - 8}>{GOAL} баллов</text>
        <motion.path d={AREA} fill="url(#lnd-ga)" initial={anim ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 1, delay: 1.4 }} />
        <motion.path d={LINE} className="c-line" initial={anim ? { pathLength: 0 } : false} animate={run ? { pathLength: 1 } : undefined} transition={{ duration: 2.2, ease: 'easeInOut' }} />
        {DATA.map(([m, v], i) => (
          <motion.g key={m} initial={anim ? { opacity: 0 } : false} animate={run ? { opacity: 1 } : undefined} transition={{ duration: 0.35, delay: 0.15 + i * 0.27 }}>
            {i === last ? (
              <motion.circle
                cx={X(i)} cy={Y(v)} r={9} className="c-last"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                animate={anim && run ? { scale: [1, 1.45, 1, 1.45, 1, 1.45, 1] } : undefined}
                transition={{ delay: 2.5, duration: 2.4 }}
              />
            ) : (
              <circle cx={X(i)} cy={Y(v)} r={6} className="c-pt" />
            )}
            <text className="c-lbl" x={X(i)} y={Y(v) - 16} textAnchor="middle">{v}{i === last ? '+' : ''}</text>
          </motion.g>
        ))}
      </svg>
    </Reveal>
  )
}

/** Аргумент 6. */
export function ArgForecast() {
  return (
    <section id="a6" className="alt">
      <div className="wrap">
        <ArgHead n={6} tone="red" eb="Аргумент шестой" title="Ты знаешь свой балл ещё до экзамена" chat={CHAT} />
        <div className="fc">
          <Inputs />
          <Chart />
        </div>
      </div>
    </section>
  )
}
