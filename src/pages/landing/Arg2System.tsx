import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'
import { ArgHead } from './ArgHead'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { Icon3D } from './Icon3D'
import type { Msg } from './Chat'
import type { IconName } from './icons'

const CHAT: Msg[] = [
  { text: 'Каждый урок устроен одинаково: посмотрел видеоконспект — разобрал теорию — решил задачи — сдал ДЗ. И ты всегда видишь, что дальше.' },
]

const STEPS: Array<[IconName, string, string]> = [
  ['video', 'Видеоконспект', 'К каждому уроку — коротко и по делу'],
  ['bank', 'Теория', 'Конспект с формулами и ловушками ЕГЭ'],
  ['forecast', 'Задачи', 'Банк задач по каждому номеру экзамена'],
  ['autocheck', 'ДЗ', 'Первая часть — автопроверка сразу'],
  ['calendar', 'Что дальше', 'План на платформе: следующая тема уже ждёт'],
]

const PLAN: Array<[string, 'done' | 'now' | '']> = [
  ['Импульс тела', 'done'],
  ['Закон сохранения импульса', 'done'],
  ['Работа силы', 'now'],
  ['Мощность', ''],
  ['Кинетическая энергия', ''],
]

/**
 * Аргумент 2. Линия под шагами заполняется за 2 с (scaleX, а не width),
 * шаги выпрыгивают по очереди через 0,38 с — как в прототипе.
 */
export function Arg2System() {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const run = inView || !anim

  return (
    <section id="a2">
      <div className="wrap">
        <ArgHead n={2} eb="Аргумент второй" title="Вся подготовка — в одной системе" chat={CHAT} />
        <div className="flow" ref={ref}>
          <div className="flow-line" aria-hidden="true">
            <motion.div
              className="flow-fill"
              initial={anim ? { scaleX: 0 } : false}
              animate={run ? { scaleX: 1 } : undefined}
              transition={{ duration: 2, ease: 'easeInOut' }}
            />
          </div>
          {STEPS.map(([ic, h, p], i) => (
            <motion.div
              key={h}
              className="st"
              initial={anim ? { opacity: 0, y: 24, scale: 0.8 } : false}
              animate={run ? { opacity: 1, y: 0, scale: [0.8, 1.05, 1] } : undefined}
              transition={{ delay: i * 0.38, duration: 0.55 }}
            >
              <Icon3D name={ic} size={96} />
              <h3>{h}</h3>
              <p>{p}</p>
            </motion.div>
          ))}
        </div>
        <Reveal className="card next-plan">
          <strong>Твой план:</strong>
          <ul className="np-list">
            {PLAN.map(([t, s]) => (
              <li key={t} className={s ? `np ${s}` : 'np'}>{s === 'done' ? '✓ ' : s === 'now' ? '▶ ' : ''}{t}</li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}
