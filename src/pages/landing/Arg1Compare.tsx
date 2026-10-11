import { motion } from 'framer-motion'
import { ArgHead } from './ArgHead'
import { Stagger } from './motion'
import { staggerItem } from './anim'
import { Icon3D } from './Icon3D'
import type { Msg } from './Chat'
import type { IconName } from './icons'

const CHAT: Msg[] = [
  { me: true, text: 'А чем это лучше репетитора или большой онлайн-школы?' },
  { text: 'Давай честно сравним. У каждого варианта есть слабые места — я строил платформу так, чтобы их не было.' },
]

const CARDS: Array<{ ic: IconName; h: string; tag: string; tone: 't-red' | 't-or' | 't-blue'; good?: boolean; li: string[] }> = [
  {
    ic: 'check48', h: 'Репетитор', tag: 'мало и дорого', tone: 't-red',
    li: [
      'Нет системы: проходишь то, что решит репетитор',
      'Материалы — только на уроке, между занятиями ты один',
      '1–2 занятия в неделю — прогресс тормозится',
      'Каждый час стоит денег, поэтому занятий всегда мало',
    ],
  },
  {
    ic: 'video', h: 'Онлайн-школы', tag: 'шоу и поток', tone: 't-or',
    li: [
      'Уроки-шоу: смотреть интересно, но уходят часы — а времени до экзамена мало',
      'Рассчитаны на массовый поток, а не на тебя',
      'Жёсткие дедлайны, а часто и штрафы за несданное вовремя ДЗ',
      'Всё равно дорого',
    ],
  },
  {
    ic: 'rocket', h: 'Платформа Almiron', tag: 'система под тебя', tone: 't-blue', good: true,
    li: [
      'Чёткая система: от первой темы до экзамена',
      'Видео, теория, задачи и ДЗ — всегда под рукой',
      'Свой темп, без штрафов: темы открываются по мере решения',
      'Персональный прогноз балла и слабые места',
      'Вторая часть проверяется с помощью ИИ',
    ],
  },
]

/** Аргумент 1. Карточки всегда белые — и в тёмной теме (решение прототипа). */
export function Arg1Compare() {
  return (
    <section id="a1" className="alt">
      <div className="wrap">
        <ArgHead n={1} tone="red" eb="Аргумент первый" title="Не репетитор и не урок-шоу" chat={CHAT} />
        <Stagger className="cmp3">
          {CARDS.map(c => (
            <motion.div key={c.h} className={c.good ? 'card cc good' : 'card cc bad'} variants={staggerItem}>
              <Icon3D name={c.ic} size={64} />
              <div className="cc-top"><h3>{c.h}</h3><span className={`tag ${c.tone}`}>{c.tag}</span></div>
              <ul aria-label={c.good ? 'Плюсы' : 'Минусы'}>
                {c.li.map(t => <li key={t}>{t}</li>)}
              </ul>
              <a className="price-l" href="#price">Узнать цену →</a>
            </motion.div>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
