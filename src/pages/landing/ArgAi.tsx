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

/**
 * Решение на тетрадном листке (прототип v3): строки «пишутся» по очереди.
 * Ответ специально без единиц — соседняя карточка ловит «Нет единиц в
 * ответе», отсюда 2 из 3. [текст, задержка, класс]
 */
const PAPER: Array<[React.ReactNode, number, string?]> = [
  ['Дано: m = 2 кг, F = 10 Н,', 0],
  ['μ = 0,3;  a — ?', 0.6, 'ind'],
  ['ma = F − μmg', 1.1],
  ['a = (F − μmg) / m', 1.7],
  [<>a = (10 − 0,3·2·10) / 2 = <u>2</u></>, 2.3],
  ['Ответ: 2', 3, 'ans'],
]
const CRIT: Array<{ t: string; warn?: boolean }> = [
  { t: 'Записаны законы и формулы' },
  { t: 'Верные преобразования' },
  { t: 'Нет единиц в ответе', warn: true },
]
const SCORE = 2

/**
 * Аргумент 5. Сценарий прототипа: строки решения «пишутся» на листке, через
 * 1,3 с полоса сканирует лист и по очереди загораются критерии, к 3,6 с балл
 * досчитывает до 2 и проявляется комментарий.
 */
export function ArgAi() {
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
    <section id="a5">
      <div className="wrap">
        <ArgHead n={5} eb="Аргумент пятый" title="Вторая часть — проверка с помощью ИИ" chat={CHAT} />
        <div className="ai" ref={ref}>
          <Reveal className="card">
            <div className="num" aria-hidden="true">1</div>
            <Icon3D name="mail" size={60} />
            <h3>Фото решения</h3>
            <div className="sheet paper">
              {PAPER.map(([t, delay, cls], i) => (
                <motion.div
                  key={i}
                  className={cls ? `hl ${cls}` : 'hl'}
                  initial={anim ? { clipPath: 'inset(0 100% 0 0)' } : false}
                  animate={run ? { clipPath: 'inset(0 0% 0 0)' } : undefined}
                  transition={{ duration: 0.7, ease: 'easeOut', delay }}
                >
                  {t}
                </motion.div>
              ))}
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
