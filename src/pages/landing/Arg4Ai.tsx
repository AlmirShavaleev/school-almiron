import { animate, motion, useInView } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { ArgHead } from './ArgHead'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { Icon3D } from './Icon3D'
import type { Msg } from './Chat'

const CHAT: Msg[] = [
  { me: true, text: 'А кто проверит мои развёрнутые решения?' },
  { text: 'Искусственный интеллект разбирает решение по критериям ФИПИ и находит ошибки, а итоговый балл подтверждает преподаватель — в течение 48 часов.' },
]

const HAND = [
  'M10 18 C40 8,60 28,90 16 S140 10,170 20',
  'M10 44 C50 36,80 52,120 42 S190 36,240 46',
  'M10 70 C40 64,70 78,110 68 S160 64,200 72',
  'M10 96 C30 90,60 102,90 94',
]
const CRIT: Array<{ t: string; warn?: boolean }> = [
  { t: 'Записаны законы и формулы' },
  { t: 'Верные преобразования' },
  { t: 'Нет единиц в ответе', warn: true },
]
const SCORE = 2

/**
 * Аргумент 4. Сценарий прототипа: строки решения «пишутся» (pathLength), через
 * 1,3 с полоса сканирует лист и по очереди загораются критерии, к 3,6 с балл
 * досчитывает до 2 и проявляется комментарий.
 */
export function Arg4Ai() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const [scanning, setScanning] = useState(false)
  const [lit, setLit] = useState(0)
  const [score, setScore] = useState(0)
  const [commented, setCommented] = useState(false)

  useEffect(() => {
    if (!anim || !inView) return
    const timers: Array<ReturnType<typeof setTimeout>> = []
    let stop: (() => void) | undefined
    timers.push(setTimeout(() => setScanning(true), 1300))
    CRIT.forEach((_, i) => timers.push(setTimeout(() => setLit(i + 1), 1800 + i * 600)))
    timers.push(setTimeout(() => {
      stop = animate(0, SCORE, { duration: 0.8, onUpdate: v => setScore(Math.round(v)) }).stop
      setCommented(true)
    }, 3600))
    return () => { timers.forEach(clearTimeout); stop?.() }
  }, [anim, inView])

  const shownLit = anim ? lit : CRIT.length
  const shownScore = anim ? score : SCORE
  const run = inView || !anim

  return (
    <section id="a4">
      <div className="wrap">
        <ArgHead n={4} eb="Аргумент четвёртый" title="Вторая часть — проверка с помощью ИИ" chat={CHAT} />
        <div className="ai" ref={ref}>
          <Reveal className="card">
            <div className="num" aria-hidden="true">1</div>
            <Icon3D name="mail" size={60} />
            <h3>Фото решения</h3>
            <div className="sheet">
              <svg viewBox="0 0 300 110" preserveAspectRatio="none" aria-hidden="true">
                {HAND.map((d, i) => (
                  <motion.path
                    key={d}
                    d={d}
                    initial={anim ? { pathLength: 0 } : false}
                    animate={run ? { pathLength: 1 } : undefined}
                    transition={{ duration: 0.8, ease: 'easeOut', delay: i * 0.3 }}
                  />
                ))}
              </svg>
            </div>
            <p className="txt">Решаешь на бумаге, как на экзамене, и загружаешь фото.</p>
          </Reveal>
          <Reveal className="card">
            <div className="num" aria-hidden="true">2</div>
            <Icon3D name="diagnostic" size={60} />
            <h3>ИИ сверяет с критериями</h3>
            <div className="sheet auto">
              {anim && (
                <motion.div
                  className="scan"
                  initial={{ y: 0 }}
                  animate={scanning ? { y: [0, 164] } : undefined}
                  transition={{ duration: 1.3, repeat: 1, ease: 'easeInOut' }}
                />
              )}
              <ul className="crit">
                {CRIT.map((c, i) => (
                  <li key={c.t} className={[i < shownLit && 'ok', c.warn && 'warn'].filter(Boolean).join(' ') || undefined}>
                    <i aria-hidden="true">{c.warn ? '!' : '✓'}</i>{c.t}
                  </li>
                ))}
              </ul>
            </div>
            <p className="txt">Черновая оценка и список ошибок — быстро.</p>
          </Reveal>
          <Reveal className="card">
            <div className="num" aria-hidden="true">3</div>
            <Icon3D name="check48" size={60} />
            <h3>Балл и разбор — до 48 ч</h3>
            <div className="score"><b>{shownScore}</b> <span>из 3</span></div>
            <motion.div
              className="cmt"
              initial={anim ? { opacity: 0, y: 14 } : false}
              animate={commented || !anim ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.5 }}
            >
              «Решение верное, но в ответе нет единиц — на экзамене за это снимут балл».
            </motion.div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
