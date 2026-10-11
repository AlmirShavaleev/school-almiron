import { animate, motion, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Reveal } from './motion'
import { Plate } from './Brand'
import { useAnim } from './anim'
import { Icon3D } from './Icon3D'

const HAND = [
  'M10 20 C40 10,60 30,90 18 S140 12,170 22',
  'M10 48 C50 40,80 56,120 46 S190 40,240 50',
  'M10 76 C40 70,70 84,110 74 S160 70,200 78',
  'M10 104 C30 98,60 110,90 102',
]
const CRIT = ['Записаны законы и формулы', 'Верные преобразования', 'Правильный ответ с единицами']

/**
 * Три шага проверки. Сценарий, как в прототипе: строки решения
 * «пишутся», через 1,5 с полоса сканирует лист и по очереди загораются
 * критерии, к 3,8 с балл досчитывает до 3 и проявляется комментарий.
 */
export function CheckPartTwo() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const [scanning, setScanning] = useState(false)
  const [okCount, setOkCount] = useState(0)
  const [score, setScore] = useState(0)
  const [commented, setCommented] = useState(false)

  useEffect(() => {
    if (!anim || !inView) return
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let stop: (() => void) | undefined
    timers.push(setTimeout(() => setScanning(true), 1500))
    CRIT.forEach((_, i) => timers.push(setTimeout(() => setOkCount(i + 1), 2000 + i * 600)))
    timers.push(setTimeout(() => {
      stop = animate(0, 3, { duration: 0.9, onUpdate: v => setScore(Math.round(v)) }).stop
      setCommented(true)
    }, 3800))
    return () => { timers.forEach(clearTimeout); stop?.() }
  }, [anim, inView])

  const lit = anim ? okCount : CRIT.length
  const shownScore = anim ? score : 3

  return (
    <section id="check" className="alt">
      <div className="wrap">
        <Reveal className="sec-head with-ic">
          <Icon3D name="part2" size={88} className="head-ic" />
          <span className="eyebrow">Проверка второй части <span className="tag tag-soon">запускаем</span></span>
          <h2>Развёрнутые решения проверяют по критериям ФИПИ в течение 48 часов</h2>
          <p className="lead">ИИ разбирает решение по критериям экзамена и находит ошибки, итоговый балл подтверждает преподаватель.</p>
        </Reveal>
        <div className="grid chk" ref={ref}>
          <Reveal className="card">
            <div className="num">1</div><h3>Фото решения</h3>
            <div className="sheet">
              <svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true">
                {HAND.map((d, i) => (
                  <motion.path
                    key={d}
                    d={d}
                    initial={anim ? { pathLength: 0 } : false}
                    animate={inView || !anim ? { pathLength: 1 } : undefined}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.35 }}
                  />
                ))}
              </svg>
            </div>
            <p className="txt">Решаешь на бумаге, как на экзамене, и загружаешь фото.</p>
          </Reveal>
          <Reveal className="card">
            <div className="num">2</div><h3>ИИ сверяет с критериями</h3>
            <div className="sheet auto plate-like">
              <div className="plate-h"><b>Критерии ФИПИ</b><span>задача № 24</span></div>
              {anim && (
                <motion.div
                  className="scan"
                  initial={{ y: 0 }}
                  animate={scanning ? { y: [0, 170] } : undefined}
                  transition={{ duration: 1.4, repeat: 1, ease: 'easeInOut' }}
                />
              )}
              <ul className="crit">
                {CRIT.map((c, i) => <li key={c} className={i < lit ? 'ok' : undefined}><i>✓</i>{c}</li>)}
              </ul>
            </div>
            <p className="txt">Черновая оценка и список ошибок — быстро.</p>
          </Reveal>
          <Reveal className="card">
            <div className="num">3</div><h3 className="h-ic"><Icon3D name="check48" size={56} />Балл и разбор</h3>
            <div className="score"><b>{shownScore}</b> <span>из 3</span></div>
            <motion.div
              initial={anim ? { opacity: 0, y: 16 } : false}
              animate={commented || !anim ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.6 }}
            >
              <Plate tone="trap" title="Комментарий" note="ДЗ · вторая часть">
                «Решение верное. В следующий раз подпиши, какую систему отсчёта выбрал, — на экзамене за это не снимут, но так понятнее».
              </Plate>
            </motion.div>
            <p className="txt" style={{ marginTop: 12 }}>Балл и комментарий — до 48 часов.</p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
