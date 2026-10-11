import { animate, motion, useAnimate, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from './motion'
import { EASE, useAnim } from './anim'
import { LINKS } from './links'

export const PRICE_MONTH = 500
export const PRICE_YEAR = 4800

const fmt = (n: number) => n.toLocaleString('ru-RU')

/** Сравнение месяца подготовки; ширина полос — доля от самого дорогого. */
const CMP: Array<{ t: string; w: number; v: string; us?: boolean }> = [
  { t: 'Подписка Almiron', w: 4.6, v: '500 ₽', us: true },
  { t: 'Групповой курс крупной онлайн-школы*', w: 27.8, v: '≈ 3 000 ₽' },
  { t: 'Онлайн-группа до 25 человек**', w: 100, v: 'от 10 800 ₽' },
]

function Compare() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const run = inView || !anim
  return (
    <Reveal className="card cmp">
      <div ref={ref}>
        <h3>Сколько стоит месяц подготовки по одному предмету</h3>
        {CMP.map((r, k) => (
          <div key={r.t} className={r.us ? 'c-row us' : 'c-row'}>
            <span>{r.t}</span>
            <div className="bar">
              <motion.i
                style={{ width: `${r.w}%` }}
                initial={anim ? { scaleX: 0 } : false}
                animate={run ? { scaleX: 1 } : undefined}
                transition={{ duration: 1.2, delay: k * 0.2, ease: EASE }}
              />
            </div>
            <span className="v">{r.v}</span>
          </div>
        ))}
        <p className="foot">
          * Оценка: годовой групповой курс ЕГЭ ≈ 25 000 ₽ до конца мая,{' '}
          <a href="https://mel.fm/ucheba/yege/3752196-gotovy-platit-do-750-tysyach-v-god-skolko-stoit-podgotovka-k-oge-i-yege-i-mozhno-li-vernut-chast-den" target="_blank" rel="noopener noreferrer">«Мел», декабрь 2025</a>.
          {' '}** <a href="https://maximumtest.ru/ege/fizika" target="_blank" rel="noopener noreferrer">Сайт школы</a>, данные на 11.10.2026. Форматы различаются составом услуг.
        </p>
      </div>
    </Reveal>
  )
}

const planReveal = (anim: boolean) => ({
  initial: anim ? { opacity: 0, y: 34 } : false,
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.2 },
  transition: { duration: 0.7, ease: EASE },
  whileHover: { y: -8 },
}) as const

export function Prices() {
  const anim = useAnim()
  const [yearly, setYearly] = useState(false)
  const [shown, setShown] = useState(PRICE_MONTH)
  const shownRef = useRef(PRICE_MONTH)
  const [best, pulse] = useAnimate<HTMLDivElement>()
  const stop = useRef<(() => void) | undefined>(undefined)

  useEffect(() => () => stop.current?.(), [])

  const choose = (y: boolean) => {
    if (y === yearly) return
    setYearly(y)
    const to = y ? PRICE_YEAR : PRICE_MONTH
    stop.current?.()
    if (!anim) { shownRef.current = to; setShown(to); return }
    pulse(best.current, { scale: [1, 1.03, 1] }, { duration: 0.4 })
    stop.current = animate(shownRef.current, to, {
      duration: 0.6,
      onUpdate: v => { shownRef.current = v; setShown(Math.round(v)) },
    }).stop
  }

  return (
    <section id="prices" className="alt wm">
      <div className="wrap">
        <Reveal className="sec-head center">
          <span className="eyebrow">Цена</span>
          <h2>Один тариф — всё включено</h2>
          <p className="lead">Курс растёт вместе с первыми учениками, поэтому сейчас он стоит как одна поездка на такси. Начни с трёх бесплатных дней.</p>
        </Reveal>
        <div className="center">
          <div className="tabs" role="tablist" aria-label="Срок подписки">
            <button type="button" role="tab" aria-selected={!yearly} className={!yearly ? 'on' : undefined} onClick={() => choose(false)}>На месяц</button>
            <button type="button" role="tab" aria-selected={yearly} className={yearly ? 'on' : undefined} onClick={() => choose(true)}>
              На год <span className="tag tag-ok">−20%</span>
            </button>
          </div>
        </div>
        <div className="grid plans">
          <motion.div className="card plan" {...planReveal(anim)}>
            <span className="tag tag-ok">Демо</span>
            <h3 className="mt">3 дня бесплатно</h3>
            <div className="price">0 ₽</div>
            <span className="note">Без привязки карты</span>
            <ul>
              <li>Полный доступ ко всему курсу на 3 дня</li>
              <li>Диагностика и личный план</li>
              <li>Можно сдать первые ДЗ</li>
              <li>Ничего не спишется автоматически</li>
            </ul>
            <Link className="btn btn-g" to={LINKS.register}>Зарегистрироваться</Link>
          </motion.div>
          <motion.div className="card plan best" {...planReveal(anim)}>
            <div ref={best}>
              <span className="badge">Всё включено</span>
              <h3>Подписка Almiron</h3>
              <div className="price" data-testid="price">
                <span>{fmt(shown)}</span> ₽<small>{yearly ? ' / год' : ' / месяц'}</small>
              </div>
              <span className="note">{yearly ? '400 ₽ в месяц — на 20% выгоднее' : 'Платишь помесячно, отмена в один клик'}</span>
              <ul>
                <li>Видеоконспекты и банк задач по каждому номеру</li>
                <li>Темы открываются по мере прохождения</li>
                <li>ДЗ с автопроверкой</li>
                <li>Вторая часть по критериям ФИПИ — до 48 ч</li>
                <li>Пробник ЕГЭ раз в месяц и прогноз балла</li>
              </ul>
              <Link className="btn btn-p" to={LINKS.register}>Начать с 3 бесплатных дней</Link>
            </div>
          </motion.div>
        </div>
        <Compare />
      </div>
    </section>
  )
}
