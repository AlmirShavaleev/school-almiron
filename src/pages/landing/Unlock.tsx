import { motion, useAnimate, useInView } from 'framer-motion'
import { useRef, useState } from 'react'
import { Reveal } from './motion'
import { EASE, useAnim } from './anim'
import { Icon3D } from './Icon3D'
import { initialUnlock, SECTIONS, submitHomework, type LessonState } from './unlockLogic'

type Seg = { t: string; w: number; bg: string }

const OTHER: Seg[] = [
  { t: 'Механика', w: 34, bg: '#8a97b5' },
  { t: 'МКТ', w: 24, bg: '#7a88a8' },
  { t: 'Электро', w: 26, bg: '#6b799b' },
  { t: 'Опт.', w: 9, bg: 'var(--or)' },
  { t: 'Кв.', w: 7, bg: '#c76a12' },
]
const US: Seg[] = [
  { t: 'Механика', w: 20, bg: '#4a72f0' },
  { t: 'МКТ', w: 14, bg: '#2f5bea' },
  { t: 'Электро', w: 18, bg: '#2449c4' },
  { t: 'Оптика', w: 10, bg: '#1f3fa8' },
  { t: 'Кв.', w: 9, bg: '#13254d' },
  { t: 'Пробники', w: 29, bg: 'var(--good)' },
]

/**
 * Шкала по месяцам. Ширины сегментов заданы сразу (раскладка не меняется),
 * «рост» — `scaleX` от левого края: только transform, без пересчёта ширин.
 */
function Timeline({ segs, step, start, shown, anim }: { segs: Seg[]; step: number; start: number; shown: boolean; anim: boolean }) {
  return (
    <div className="tl">
      {segs.map((s, k) => (
        <motion.i
          key={s.t}
          style={{ background: s.bg, width: `calc(${s.w}% - 3px)` }}
          initial={anim ? { scaleX: 0 } : false}
          animate={shown ? { scaleX: 1 } : undefined}
          transition={{ duration: 0.6, delay: start + k * step, ease: EASE }}
        >
          {s.t}
        </motion.i>
      ))}
    </div>
  )
}

const ICON: Record<LessonState, string> = { done: '✓', open: '▶', locked: '🔒' }

function UnlockDemo() {
  const anim = useAnim()
  const [st, setSt] = useState(initialUnlock)
  const [scope, animate] = useAnimate()

  const submit = (si: number) => {
    const { next, changed } = submitHomework(st, si)
    setSt(next)
    if (anim) {
      requestAnimationFrame(() => {
        // Урок открылся — замок в углу качается.
        const lock = scope.current?.querySelector('.lock-swing')
        if (lock && changed.length) animate(lock, { rotate: [0, -15, 10, 0] }, { duration: 0.7, ease: 'easeInOut' })
        changed.forEach(li => {
          const el = scope.current?.querySelector(`[data-k="${si}-${li}"]`)
          if (el) animate(el, { scale: [0.85, 1.06, 1], opacity: [0.3, 1] }, { duration: 0.55, ease: [0.2, 1.4, 0.4, 1] })
        })
      })
    }
  }

  return (
    <div className="u-grid" ref={scope}>
      <span className="corner-ic lock-swing"><Icon3D name="unlock" size={84} /></span>
      {SECTIONS.map((s, si) => (
        <div className="u-col" key={s.n}>
          <h4>{s.n}</h4>
          {s.l.map((t, li) => {
            const c = st[si][li]
            return (
              <div key={t} className={`les ${c}`} data-k={`${si}-${li}`} data-state={c}>
                <span className="ic" aria-hidden="true">{ICON[c]}</span>{t}
              </div>
            )
          })}
          <button type="button" className="u-btn" disabled={!st[si].includes('open')} onClick={() => submit(si)}>Сдать ДЗ</button>
        </div>
      ))}
    </div>
  )
}

export function Unlock() {
  const anim = useAnim()
  const vsRef = useRef<HTMLDivElement>(null)
  const inView = useInView(vsRef, { once: true, amount: 0.35 })
  const shown = !anim || inView

  const warn = {
    initial: anim ? { opacity: 0, scale: 0.8 } : false,
    animate: shown ? { opacity: 1, scale: 1 } : undefined,
    transition: { delay: 2, duration: 0.4 },
  } as const

  return (
    <section id="unlock">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Как открываются уроки</span>
          <h2>Уроки открываются по мере прохождения, а не по календарю</h2>
          <p className="lead">В онлайн-школах годовой курс открывается по датам: темы выходят раз в неделю, и на последние разделы к весне остаётся совсем мало времени. У нас следующая тема открывается, как только домашка по предыдущей принята. Хочешь быстрее — проходи быстрее.</p>
        </Reveal>
        <div className="vs" ref={vsRef}>
          <Reveal className="card">
            <span className="tag tag-soon">В других онлайн-школах</span>
            <h3>Открытие по датам</h3>
            <p className="s">Сентябрь и октябрь уходят на механику, а оптика и кванты достаются на последние недели перед экзаменом.</p>
            <Timeline segs={OTHER} step={0.35} start={0} shown={shown} anim={anim} />
            <div className="tl-axis"><span>сентябрь</span><span>май</span></div>
            <motion.span className="tag tag-soon warn" {...warn}>На оптику и кванты — пара недель</motion.span>
          </Reveal>
          <Reveal className="card us">
            <span className="tag tag-ok">В Almiron</span>
            <h3>Открытие по прохождению</h3>
            <p className="s">ДЗ принято — сразу следующая тема. Курс можно пройти быстрее и оставить время на пробники и сложные разделы.</p>
            <Timeline segs={US} step={0.18} start={0.3} shown={shown} anim={anim} />
            <div className="tl-axis"><span>старт</span><span>экзамен</span></div>
            <motion.span className="tag tag-ok warn" {...warn}>Время остаётся на всё</motion.span>
          </Reveal>
        </div>
        <Reveal className="card unlock-wrap has-corner">
          <div className="u-legend">
            <span><b style={{ background: 'var(--good)' }} />Тема закрыта</span>
            <span><b style={{ background: 'var(--p500)' }} />Открыта</span>
            <span><b style={{ background: 'var(--line)' }} />Откроется после предыдущей</span>
            <span>Нажми «Сдать ДЗ» — и посмотри, как открывается следующий урок</span>
          </div>
          <UnlockDemo />
          <p className="u-note">Тема закрыта, когда ДЗ принято: первая часть решена полностью, а вторая — проверена (до 48 часов). Пока ждёшь проверку, занимайся в другом разделе: в каждом сразу открыты первые уроки. Пришёл в середине года — всё, что прошли другие, уже открыто.</p>
        </Reveal>
      </div>
    </section>
  )
}
