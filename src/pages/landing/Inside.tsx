import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { Reveal, Stagger } from './motion'
import { staggerChild } from './anim'

const CARDS: Array<{ icon: ReactNode; h: string; p: string }> = [
  { icon: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 9l5 3-5 3z" /></>, h: 'Видеоконспект к каждому уроку', p: 'Вся теория урока в коротком видео. Пересматривай, когда нужно.' },
  { icon: <><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 4v16" /></>, h: 'Банк задач по каждому номеру', p: 'Задачи для подготовки к ЕГЭ, разложенные по номерам экзамена, с решениями.' },
  { icon: <path d="M5 12l4 4L19 6" />, h: 'ДЗ с автопроверкой', p: 'Ответы первой части проверяются сразу — видно ошибку, пока тема свежая.' },
  { icon: <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" />, h: 'Вторая часть с помощью ИИ', p: 'Развёрнутые решения проверяются по критериям ФИПИ с разбором ошибок.' },
  { icon: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>, h: 'Пробник ЕГЭ раз в месяц', p: 'Полный вариант в формате экзамена, баллы и разбор каждой ошибки.' },
  { icon: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />, h: 'Прогноз балла', p: 'По результатам пробников видно, сколько наберёшь и какие темы тянут вниз.' },
]

export function Inside() {
  return (
    <section id="inside">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Что внутри</span>
          <h2>Вся подготовка — в одной системе</h2>
          <p className="lead">Не набор вебинаров, а курс, который ведёт тебя от первой темы до пробника.</p>
        </Reveal>
        <Stagger className="grid inside">
          {CARDS.map(c => (
            <motion.div key={c.h} className="card f-card" variants={staggerChild} whileHover={{ y: -6 }}>
              <div className="f-ic"><svg viewBox="0 0 24 24" aria-hidden="true">{c.icon}</svg></div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
