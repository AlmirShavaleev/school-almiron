import { motion } from 'framer-motion'
import { Reveal, Stagger } from './motion'
import { staggerChild } from './anim'
import { Icon3D } from './Icon3D'
import type { IconName } from './icons'

const CARDS: Array<{ icon: IconName; h: string; p: string }> = [
  { icon: 'video', h: 'Видеоконспект к каждому уроку', p: 'Вся теория урока в коротком видео. Пересматривай, когда нужно.' },
  { icon: 'bank', h: 'Банк задач по каждому номеру', p: 'Задачи для подготовки к ЕГЭ, разложенные по номерам экзамена, с решениями.' },
  { icon: 'autocheck', h: 'ДЗ с автопроверкой', p: 'Ответы первой части проверяются сразу — видно ошибку, пока тема свежая.' },
  { icon: 'part2', h: 'Вторая часть с помощью ИИ', p: 'Развёрнутые решения проверяются по критериям ФИПИ с разбором ошибок.' },
  { icon: 'mock', h: 'Пробник ЕГЭ раз в месяц', p: 'Полный вариант в формате экзамена, баллы и разбор каждой ошибки.' },
  { icon: 'forecast', h: 'Прогноз балла', p: 'По результатам пробников видно, сколько наберёшь и какие темы тянут вниз.' },
]

export function Inside() {
  return (
    <section id="inside" className="wm">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">Что внутри</span>
          <h2>Вся подготовка — в одной системе</h2>
          <p className="lead">Не набор вебинаров, а курс, который ведёт тебя от первой темы до пробника.</p>
        </Reveal>
        <Stagger className="grid inside">
          {CARDS.map(c => (
            <motion.div key={c.h} className="card f-card" variants={staggerChild} whileHover={{ y: -6 }}>
              <Icon3D name={c.icon} size={76} className="f-ic" inherit />
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
