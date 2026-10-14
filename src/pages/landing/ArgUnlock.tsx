import { motion, useAnimate, useInView } from 'framer-motion'
import { useRef, useState } from 'react'
import { ArgHead } from './ArgHead'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { iconSrc } from './icons'
import type { Msg } from './Chat'
import { initialUnlock, LESSONS, SECTION, submitHomework, type LessonState } from './unlockLogic'

/**
 * Обещание «ключей» из прототипа v3. На платформе такой функции сейчас НЕТ —
 * фраза вынесена отдельно, чтобы владелец решил: оставить (тогда «ключи» —
 * задача агенту подписки) или заменить мягкой формулировкой. Вопрос — в
 * отчёте `лендинг_v3_отчёт.md`.
 */
const KEYS_PHRASE = 'Плюс у тебя есть несколько ключей: ими можно открыть любую тему раньше — например, ту, что завтра проходите в школе.'

const CHAT: Msg[] = [
  { text: `В онлайн-школах уроки открываются по датам, и к весне на оптику и кванты остаётся пара недель. У меня следующая тема открывается, как только ты решил предыдущую. А если застрял — она откроется по сроку, и ты не отстанешь. ${KEYS_PHRASE}` },
]

type Seg = { t: string; w: number; bg: string }
const BY_DATE: Seg[] = [
  { t: 'Механика', w: 34, bg: '#9aa3b8' },
  { t: 'МКТ', w: 24, bg: '#8a94ab' },
  { t: 'Электро', w: 26, bg: '#7a859e' },
  { t: 'Опт.', w: 9, bg: 'var(--orange)' },
  { t: 'Кв.', w: 7, bg: 'var(--red)' },
]
const BY_PROGRESS: Seg[] = [
  { t: 'Механика', w: 20, bg: '#5b82f0' },
  { t: 'МКТ', w: 14, bg: 'var(--blue)' },
  { t: 'Электро', w: 18, bg: 'var(--blue2)' },
  { t: 'Оптика', w: 10, bg: '#1a3aa8' },
  { t: 'Кв.', w: 9, bg: 'var(--navy)' },
  { t: 'Пробники', w: 29, bg: 'var(--green)' },
]
const MONTHS = ['сен', 'окт', 'ноя', 'дек', 'янв', 'фев', 'мар', 'апр', 'май']

/**
 * Шкала по месяцам. Ширины заданы сразу (раскладка не меняется), «рост» —
 * `scaleX` от левого края: только transform, без пересчёта ширин.
 */
function Timeline({ segs, start, step, run, anim }: { segs: Seg[]; start: number; step: number; run: boolean; anim: boolean }) {
  return (
    <>
      <div className="tl">
        {segs.map((s, k) => (
          <motion.i
            key={s.t}
            style={{ background: s.bg, width: `calc(${s.w}% - 3px)` }}
            initial={anim ? { scaleX: 0 } : false}
            animate={run ? { scaleX: 1 } : undefined}
            transition={{ duration: 0.6, delay: start + k * step }}
          >
            {s.t}
          </motion.i>
        ))}
      </div>
      <div className="tl-axis" aria-hidden="true">{MONTHS.map(m => <span key={m}>{m}</span>)}</div>
    </>
  )
}

const ICON: Record<LessonState, string> = { done: '✓', open: '▶', locked: '🔒' }
const STATE_LABEL: Record<LessonState, string> = { done: 'пройдена', open: 'открыта', locked: 'закрыта' }

function UnlockDemo() {
  const anim = useAnim()
  const [st, setSt] = useState(initialUnlock)
  const [scope, animate] = useAnimate<HTMLDivElement>()

  const submit = () => {
    const { next, changed, unlocked } = submitHomework(st)
    setSt(next)
    if (!anim) return
    requestAnimationFrame(() => {
      changed.forEach(k => {
        const el = scope.current?.querySelector(`[data-k="${k}"]`)
        if (el) animate(el, { scale: [0.8, 1.08, 1] }, { duration: 0.5 })
      })
      const lock = scope.current?.querySelector('.lock')
      if (unlocked && lock) animate(lock, { rotate: [0, -18, 12, -6, 0], scale: [1, 1.12, 1] }, { duration: 0.7 })
    })
  }

  return (
    <Reveal className="card u-demo">
      <div ref={scope} style={{ display: 'contents' }}>
        <img className="ic3d lock" src={iconSrc('unlock')} alt="" width={90} height={90} loading="lazy" decoding="async" />
        <div>
          <div className="u-title">Раздел «{SECTION}»</div>
          <ul className="u-row" aria-live="polite">
            {LESSONS.map((t, k) => (
              <li key={t} className={`les ${st[k]}`} data-k={k} data-state={st[k]}>
                <span className="i" aria-hidden="true">{ICON[st[k]]}</span>{t}
                <span className="sr">, {STATE_LABEL[st[k]]}</span>
              </li>
            ))}
          </ul>
          <div className="u-act">
            <button type="button" className="btn btn-p" disabled={!st.includes('open')} onClick={submit}>Сдать ДЗ →</button>
            <span className="foot">Сдай ДЗ по теме — и сразу откроется следующая</span>
          </div>
        </div>
      </div>
    </Reveal>
  )
}

/** Аргумент 4. */
export function ArgUnlock() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const run = inView || !anim

  return (
    <section id="a4" className="alt">
      <div className="wrap">
        <ArgHead n={4} tone="or" eb="Аргумент четвёртый" title="Темы открываются, когда ты готов" chat={CHAT} />
        <div className="vs" ref={ref}>
          <Reveal className="card">
            <span className="tag t-red">По датам — в других школах</span>
            <Timeline segs={BY_DATE} start={0} step={0.35} run={run} anim={anim} />
            <p className="foot">Последние разделы — впопыхах перед экзаменом.</p>
          </Reveal>
          <Reveal className="card us">
            <span className="tag t-blue">По мере решения — в Almiron</span>
            <Timeline segs={BY_PROGRESS} start={0.3} step={0.18} run={run} anim={anim} />
            <p className="foot">Курс проходится быстрее, остаётся время на пробники.</p>
          </Reveal>
        </div>
        <UnlockDemo />
      </div>
    </section>
  )
}
