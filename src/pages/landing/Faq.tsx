import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { Reveal } from './motion'
import { useAnim } from './anim'

const FAQ: Array<[string, string]> = [
  ['Подойдёт, если я совсем не понимаю физику?', 'Да. Диагностика покажет, с чего начать, а темы идут от простого к сложному — каждая открывается, когда ты готов.'],
  ['Сколько времени нужно в неделю?', 'Сколько готов. Обычно 2–3 темы в неделю и пробник раз в месяц. Застрял — тема всё равно откроется по сроку.'],
  ['Кто проверяет вторую часть?', 'ИИ разбирает решение по критериям ФИПИ, итоговый балл подтверждает преподаватель — до 48 часов.'],
  ['Как родителю видеть прогресс?', 'На платформе есть страница прогресса: закрытые темы, ДЗ, пробники и прогноз балла.'],
  ['Как отменить подписку?', 'В личном кабинете, в один клик. Первые 3 дня — бесплатно и без карты.'],
]

/** Вопрос-аккордеон. Ответ — через opacity/transform, без анимации высоты. */
function Question({ q, a, i }: { q: string; a: string; i: number }) {
  const anim = useAnim()
  const [open, setOpen] = useState(false)
  const id = `lnd-faq-${i}`
  return (
    <div className={open ? 'q open' : 'q'}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        {q}<span aria-hidden="true">+</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            className="a"
            initial={anim ? { opacity: 0, y: -6 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={anim ? { opacity: 0 } : undefined}
            transition={{ duration: 0.25 }}
          >
            <p>{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Faq() {
  return (
    <section id="faq" style={{ paddingTop: 20 }}>
      <div className="wrap faq">
        <Reveal><h2>Частые вопросы</h2></Reveal>
        {FAQ.map(([q, a], i) => <Question key={q} q={q} a={a} i={i} />)}
      </div>
    </section>
  )
}
