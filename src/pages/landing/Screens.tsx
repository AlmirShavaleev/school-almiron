import { motion, type Variants } from 'framer-motion'
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { BankScreen, HomeworkScreen, PartTwoScreen, VideoScreen, type ScreenProps } from './ScreenMocks'

/** Через сколько вкладка переключается сама. */
export const SCREEN_INTERVAL_MS = 5000

const TABS: Array<{ b: string; s: string; C: ComponentType<ScreenProps> }> = [
  { b: 'Видеоконспект', s: 'Теория урока в коротком видео', C: VideoScreen },
  { b: 'ДЗ с автопроверкой', s: 'Ответ проверяется сразу', C: HomeworkScreen },
  { b: 'Вторая часть', s: 'Фото решения и разбор по критериям', C: PartTwoScreen },
  { b: 'Банк задач', s: 'Задачи по каждому номеру ЕГЭ', C: BankScreen },
]

const pane: Variants = {
  off: { opacity: 0, y: -12, transition: { duration: 0.25 } },
  on: { opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.1, delayChildren: 0.2, staggerChildren: 0.04 } },
}

/**
 * «Как это выглядит»: четыре вкладки с макетами, автопереключение раз в 5 с,
 * клик по вкладке перезапускает отсчёт. Все панели лежат в одной ячейке сетки
 * друг на друге — высота рамки равна самой высокой и не прыгает (CLS).
 *
 * `images` — реальные скриншоты по порядку вкладок, когда появятся.
 */
export function Screens({ images = [] }: { images?: Array<string | undefined> }) {
  const anim = useAnim()
  const [idx, setIdx] = useState(0)
  const [cycle, setCycle] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const restart = useCallback(() => {
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      setIdx(i => (i + 1) % TABS.length)
      setCycle(c => c + 1)
    }, SCREEN_INTERVAL_MS)
  }, [])

  useEffect(() => {
    restart()
    return () => clearInterval(timer.current)
  }, [restart])

  const choose = (i: number) => {
    setIdx(i)
    setCycle(c => c + 1)
    restart()
  }

  return (
    <section id="screens" className="alt">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Как это выглядит</span>
          <h2>Загляни внутрь платформы</h2>
          <p className="lead">Видеоконспекты, ДЗ с автопроверкой, вторая часть и банк задач — всё в одном кабинете.</p>
        </Reveal>
        <Reveal className="scr">
          <div className="scr-tabs" role="tablist" aria-label="Экраны платформы">
            {TABS.map((t, i) => (
              <button
                key={t.b}
                type="button"
                role="tab"
                aria-selected={i === idx}
                className={i === idx ? 'on' : undefined}
                onClick={() => choose(i)}
              >
                <b>{t.b}</b><small>{t.s}</small>
                {anim && i === idx && (
                  <motion.span
                    key={cycle}
                    className="tprog"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: SCREEN_INTERVAL_MS / 1000, ease: 'linear' }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="frame">
            <div className="fr-bar"><i /><i /><i /><span>almiron · кабинет ученика</span></div>
            <div className="fr-body">
              {TABS.map(({ C, b }, i) => (
                <motion.div
                  key={b}
                  className="pane"
                  role="tabpanel"
                  aria-hidden={i !== idx}
                  style={{ pointerEvents: i === idx ? 'auto' : 'none' }}
                  variants={pane}
                  initial={anim ? 'off' : false}
                  animate={i === idx ? 'on' : 'off'}
                >
                  <C image={images[i]} />
                </motion.div>
              ))}
            </div>
          </div>
        </Reveal>
        <p className="foot center">Макеты экранов. Перед запуском заменим реальными скриншотами платформы.</p>
      </div>
    </section>
  )
}
