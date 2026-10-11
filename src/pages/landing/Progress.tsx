import { animate, motion, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Reveal } from './motion'
import { EASE, useAnim } from './anim'
import { Mark } from './Brand'

/** Условный прогноз на макете (подпись «Цифры условные» не убирать). */
const FORECAST = 71
const WEAK: Array<{ t: string; v: number; label: string; low?: boolean }> = [
  { t: 'Кинематика', v: 92, label: '92%' },
  { t: 'Законы сохранения', v: 78, label: '78%' },
  { t: 'Электростатика', v: 41, label: '41% — тянет вниз', low: true },
]
const TG: Array<[string, string, string]> = [
  ['📚 Новое ДЗ', '«Законы сохранения» — 8 задач. Срок: пятница.', 'пн, 16:02'],
  ['✅ ДЗ проверено', 'Вторая часть: 3 из 3. Комментарий уже в кабинете.', 'ср, 11:40'],
  ['🔓 Открыт новый урок', '«Статика». Видеоконспект и задачи ждут.', 'ср, 11:41'],
  ['📝 Пробник месяца', 'Октябрьский пробник открыт до 31 октября.', 'чт, 09:00'],
  ['📊 Итоги недели', 'Закрыто тем: 3 из 3 · Прогноз: 71 балл (+3) · Подтянуть электростатику', 'вс, 19:00'],
]

export function Progress() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const run = inView || !anim
  const [num, setNum] = useState(0)

  useEffect(() => {
    if (!anim || !inView) return
    return animate(0, FORECAST, { duration: 1.6, ease: EASE, onUpdate: v => setNum(Math.round(v)) }).stop
  }, [anim, inView])

  return (
    <section>
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Прогресс и прогноз</span>
          <h2>Знаешь свой балл до экзамена</h2>
          <p className="lead">Прогноз считается по твоим пробникам и домашкам. Это оценка, а не гарантия, но она честно показывает, где ты сейчас.</p>
        </Reveal>
        <div className="grid prog">
          <Reveal className="card">
            <div ref={ref}>
              <div className="gauge">
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <defs>
                    <linearGradient id="lnd-gg" x1="0" x2="1">
                      <stop offset="0" stopColor="#2f5bea" /><stop offset="1" stopColor="#2449c4" />
                    </linearGradient>
                  </defs>
                  <circle className="g-bg" cx="60" cy="60" r="50" fill="none" strokeWidth="12" />
                  <motion.circle
                    cx="60" cy="60" r="50" fill="none" strokeWidth="12" stroke="url(#lnd-gg)" strokeLinecap="round"
                    initial={anim ? { pathLength: 0 } : false}
                    animate={run ? { pathLength: FORECAST / 100 } : undefined}                    transition={{ duration: 1.6, ease: EASE }}
                  />
                </svg>
                <div className="g-val">
                  <span>{anim ? num : FORECAST}</span>
                  <small>прогноз баллов ЕГЭ<br />диапазон 68–74</small>
                </div>
              </div>
              <div className="weak">
                {WEAK.map((w, k) => (
                  <div className="row" key={w.t}>
                    <div><span>{w.t}</span><span>{w.label}</span></div>
                    <div className="bar">
                      <motion.i
                        className={w.low ? 'low' : undefined}
                        style={{ width: `${w.v}%` }}
                        initial={anim ? { scaleX: 0 } : false}
                        animate={run ? { scaleX: 1 } : undefined}
                        transition={{ duration: 1.1, delay: 0.3 + k * 0.15, ease: EASE }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="foot">Пример экрана. Цифры условные.</p>
            </div>
          </Reveal>
          <Reveal className="card">
            <span className="tag tag-blue">Telegram-бот</span>
            <h3 style={{ margin: '14px 0 6px' }}>Бот пишет, когда что-то происходит</h3>
            <p style={{ color: 'var(--ink2)', fontSize: 15 }}>Новое ДЗ, проверка второй части, открытый урок, пробник и итоги недели — всё приходит в Telegram. Не нужно постоянно заходить и проверять.</p>
            <div className="tg">
              <div className="tg-head"><span className="tg-ava"><Mark white size={24} /></span><div><b>Almiron бот</b><small>бот</small></div></div>
              {TG.map(([b, t, time], i) => (
                <motion.div
                  key={b}
                  className="tg-msg"
                  initial={anim ? { opacity: 0, y: 20, scale: 0.95 } : false}
                  animate={run ? { opacity: 1, y: 0, scale: 1 } : undefined}
                  transition={{ duration: 0.45, delay: 0.6 + i * 0.45 }}
                >
                  <b>{b}</b>{t}<div className="tg-time">{time}</div>
                </motion.div>
              ))}
            </div>
            <p className="foot">Пример уведомлений. Цифры условные.</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
