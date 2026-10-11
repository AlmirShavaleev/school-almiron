import { motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Reveal } from './motion'
import { useAnim } from './anim'

const STEPS: Array<[string, string]> = [
  ['Диагностика', '15 минут — и видно, что ты уже знаешь, а что нет.'],
  ['Личный план', 'План до экзамена: сколько тем в неделю, с чего начать.'],
  ['Уроки', 'Видеоконспект и задачи из банка по номерам ЕГЭ.'],
  ['Домашнее задание', 'ДЗ принято — тема закрыта и открывается следующая. Не ждёшь даты.'],
  ['Пробник раз в месяц', 'Полный вариант ЕГЭ, баллы и разбор ошибок.'],
  ['Прогноз балла', 'Видишь свой результат до экзамена, а не после.'],
]

/** Линия «заполняется», когда верх блока проходит 60 % высоты окна. */
const LINE_AT = 0.6

/**
 * «Путь ученика»: линия рисуется прокруткой (`useScroll` → `scaleY`), шаг
 * загорается, когда до него дошла линия. Шаги гаснут обратно при прокрутке
 * вверх — как в прототипе. Без анимаций линия и шаги показаны целиком.
 */
export function StudentPath() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const stepRefs = useRef<Array<HTMLDivElement | null>>([])
  const [lit, setLit] = useState<boolean[]>(() => STEPS.map(() => false))
  const { scrollYProgress } = useScroll({ target: ref, offset: [`start ${LINE_AT}`, `end ${LINE_AT}`] })

  const update = useCallback(() => {
    if (!anim) return
    const line = window.innerHeight * LINE_AT
    const next = stepRefs.current.map(el => !!el && el.getBoundingClientRect().top + 28 < line)
    setLit(prev => (prev.every((v, i) => v === next[i]) ? prev : next))
  }, [anim])

  useMotionValueEvent(scrollYProgress, 'change', update)
  useEffect(() => {
    // Первый замер: страница могла открыться уже прокрученной (якорь, «назад»).
    const raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  }, [update])

  return (
    <section className="alt">
      <div className="wrap">
        <Reveal className="sec-head center">
          <span className="eyebrow">Путь ученика</span>
          <h2>Понятно с первого дня, что делать дальше</h2>
        </Reveal>
        <div className="path" ref={ref}>
          <div className="path-line">
            <motion.div className="path-fill" style={{ scaleY: anim ? scrollYProgress : 1 }} />
          </div>
          {STEPS.map(([h, p], i) => (
            <div key={h} className={!anim || lit[i] ? 'step on' : 'step'} ref={el => { stepRefs.current[i] = el }}>
              <div className="step-dot">{i + 1}</div>
              <div><h3>{h}</h3><p>{p}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
