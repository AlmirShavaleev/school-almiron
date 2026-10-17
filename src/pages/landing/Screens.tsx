import { motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { iconSrc, SCREENS, type IconName } from './icons'

/** Через сколько вкладка переключается сама. */
export const SCREEN_INTERVAL_MS = 5000

const TABS: Array<{ t: string; ic: IconName; alt: string }> = [
  { t: 'Видеоконспект', ic: 'video', alt: 'Видеоконспект урока на платформе' },
  { t: 'ДЗ с автопроверкой', ic: 'autocheck', alt: 'Домашнее задание с автопроверкой ответов' },
  { t: 'Вторая часть и ИИ', ic: 'part2', alt: 'Проверка второй части: фото решения и разбор ИИ' },
  { t: 'Банк задач', ic: 'bank', alt: 'Банк задач по номерам ЕГЭ' },
  { t: 'Прогноз балла', ic: 'forecast', alt: 'Прогноз балла и слабые темы' },
]

/**
 * «Так выглядит платформа»: пять вкладок, реальные скриншоты, автосмена
 * раз в 5 с; клик по вкладке перезапускает отсчёт. Все картинки лежат в
 * одной рамке друг на друге (рамка 16:10, `object-fit: contain`) — высота
 * не прыгает при смене (CLS), видимая выбирается opacity.
 */
export function Screens() {
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
    <section id="inside">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="tag t-blue">Загляни внутрь</span>
          <h2>Так выглядит платформа</h2>
          <p className="lead">Реальные экраны кабинета ученика и проверки работ.</p>
        </Reveal>
        <Reveal className="scr">
          <div className="scr-tabs" role="tablist" aria-label="Экраны платформы">
            {TABS.map((t, i) => (
              <button
                key={t.t}
                type="button"
                role="tab"
                id={`lnd-tab-${i}`}
                aria-selected={i === idx}
                aria-controls="lnd-shot"
                className={i === idx ? 'on' : undefined}
                onClick={() => choose(i)}
              >
                <img src={iconSrc(t.ic)} alt="" width={40} height={40} loading="lazy" decoding="async" />
                {t.t}
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
            <div className="fr-bar"><i /><i /><i /><span>Almiron · кабинет ученика</span></div>
            <div className="shot" id="lnd-shot" role="tabpanel" aria-labelledby={`lnd-tab-${idx}`}>
              {SCREENS.map((s, i) => (
                <motion.img
                  key={s.src}
                  src={s.src}
                  alt={i === idx ? TABS[i].alt : ''}
                  aria-hidden={i !== idx}
                  width={s.w}
                  height={s.h}
                  loading="lazy"
                  decoding="async"
                  initial={false}
                  animate={i === idx ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.985 }}
                  transition={{ duration: anim ? 0.35 : 0 }}
                />
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
