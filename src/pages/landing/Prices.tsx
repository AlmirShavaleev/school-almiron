import { animate, motion, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Reveal } from './motion'
import { EASE, useAnim } from './anim'
import { LINKS } from './links'

export const PRICE_MONTH = 500
export const PRICE_YEAR = 4800

const fmt = (n: number) => n.toLocaleString('ru-RU')

/**
 * Сравнение месяца подготовки. Полоса — диапазон цены на общей шкале
 * 0–16 000 ₽ (`left`/`w` в процентах), рост — `scaleX`.
 */
const CMP: Array<{ t: string; left: number; w: number; bg: string; v: string; us?: boolean }> = [
  { t: 'Репетитор, 2 занятия в неделю', left: 45, w: 55, bg: 'var(--red)', v: '7 200–16 000 ₽' },
  { t: 'Крупная онлайн-школа', left: 18.75, w: 48.75, bg: 'var(--orange)', v: '3 000–10 800 ₽' },
  { t: 'Платформа Almiron', left: 0, w: 3.2, bg: 'var(--green)', v: '500 ₽', us: true },
]

const MEL = 'https://mel.fm/ucheba/yege/3752196-gotovy-platit-do-750-tysyach-v-god-skolko-stoit-podgotovka-k-oge-i-yege-i-mozhno-li-vernut-chast-den'
const SCHOOL = 'https://maximumtest.ru/ege/fizika'

function Compare() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const run = useInView(ref, { once: true, amount: 0.4 }) || !anim
  return (
    <Reveal className="card pbars">
      <div ref={ref}>
        {CMP.map((r, k) => (
          <div key={r.t} className={r.us ? 'pb us' : 'pb'}>
            <span>{r.t}</span>
            <div className="bar" aria-hidden="true">
              <motion.i
                style={{ left: `${r.left}%`, width: `${r.w}%`, background: r.bg }}
                initial={anim ? { scaleX: 0 } : false}
                animate={run ? { scaleX: 1 } : undefined}
                transition={{ duration: 1.1, delay: k * 0.25, ease: EASE }}
              />
            </div>
            <span className="v">{r.v}</span>
          </div>
        ))}
        <p className="foot">
          Репетитор: 900–2 000 ₽ за час в регионах × 8 занятий; онлайн-школы: групповой курс ЕГЭ ≈ 25 000 ₽ до конца мая
          (<a href={MEL} target="_blank" rel="noopener noreferrer">«Мел», 12.2025</a>) и от 10 800 ₽ в месяц
          (<a href={SCHOOL} target="_blank" rel="noopener noreferrer">сайт школы, 11.10.2026</a>).
        </p>
      </div>
    </Reveal>
  )
}

/** Цена: сравнение, переключатель месяц/год (−20 %), демо 3 дня и подписка. */
export function Prices() {
  const anim = useAnim()
  const [yearly, setYearly] = useState(false)
  const [shown, setShown] = useState(PRICE_MONTH)
  const shownRef = useRef(PRICE_MONTH)
  const stop = useRef<(() => void) | undefined>(undefined)

  useEffect(() => () => stop.current?.(), [])

  const choose = (y: boolean) => {
    if (y === yearly) return
    setYearly(y)
    const to = y ? PRICE_YEAR : PRICE_MONTH
    stop.current?.()
    if (!anim) { shownRef.current = to; setShown(to); return }
    stop.current = animate(shownRef.current, to, {
      duration: 0.6,
      onUpdate: v => { shownRef.current = v; setShown(Math.round(v)) },
    }).stop
  }

  return (
    <section id="price" className="alt">
      <div className="wrap">
        <Reveal className="sec-head center">
          <span className="tag t-green">Цена</span>
          <h2>Сколько стоит месяц подготовки</h2>
          <p className="lead">Один предмет, один месяц.</p>
        </Reveal>
        <Compare />
        <div className="bill">
          <div className="tabs" role="tablist" aria-label="Срок подписки">
            <button type="button" role="tab" aria-selected={!yearly} className={!yearly ? 'on' : undefined} onClick={() => choose(false)}>Месяц</button>
            <button type="button" role="tab" aria-selected={yearly} className={yearly ? 'on' : undefined} onClick={() => choose(true)}>Год −20%</button>
          </div>
        </div>
        <div className="plans">
          <Reveal className="card plan">
            <span className="tag t-green">Демо</span>
            <h3>3 дня бесплатно</h3>
            <div className="price">0 ₽</div>
            <span className="foot">без привязки карты</span>
            <ul>
              <li>Полный доступ к курсу</li>
              <li>Можно сдать первые ДЗ</li>
              <li>Ничего не спишется само</li>
            </ul>
            <Link className="btn btn-g" to={LINKS.register}>Попробовать</Link>
          </Reveal>
          <Reveal className="card plan best">
            <span className="badge">Всё включено</span>
            <h3>Подписка Almiron</h3>
            <div className="price" data-testid="price">
              <span>{fmt(shown)}</span> ₽<small>{yearly ? ' / год' : ' / месяц'}</small>
            </div>
            <span className="foot">{yearly ? '400 ₽ в месяц — на 20% выгоднее' : 'отмена в один клик'}</span>
            <ul>
              <li>Видеоконспекты, теория и банк задач</li>
              <li>ДЗ с автопроверкой</li>
              <li>Вторая часть с помощью ИИ — до 48 ч</li>
              <li>Пробник каждый месяц и прогноз балла</li>
              <li>Темы открываются по мере решения</li>
            </ul>
            <Link className="btn btn-p" to={LINKS.register}>Начать с 3 бесплатных дней</Link>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
