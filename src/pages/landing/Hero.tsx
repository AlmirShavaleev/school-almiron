import { motion } from 'framer-motion'
import { useCallback, useState } from 'react'
import { Chat, type Msg } from './Chat'
import { useAnim } from './anim'
import { PHOTO } from './icons'

const HELLO: Msg[] = [
  { text: <>Привет! Меня зовут <b>Альмир Шавалеев</b>.</> },
  { text: 'Я учитель физики и математики и много лет готовлю учеников к экзаменам.' },
  { text: 'Всё, что реально помогает сдать экзамен, я собрал на своей платформе. Разреши за 5 аргументов убедить тебя, что она тебе подходит.' },
  { me: true, text: 'Ну давай, убеди 🙂' },
]

/**
 * Первый экран (правка 3): слева заголовок и диалог, справа — фото владельца
 * крупно, за ним голубое пятно и статичная оранжевая орбита. По ТЗ здесь
 * нет 3D-иконок и ничего не движется, кроме самого диалога; фото — LCP,
 * грузится сразу с высоким приоритетом.
 */
export function Hero() {
  const anim = useAnim()
  const [ready, setReady] = useState(!anim)
  const onDone = useCallback(() => setReady(true), [])

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div>
          <div className="hero-name">Подготовка к ЕГЭ и ОГЭ · физика и математика</div>
          <h1>Дай мне <span className="or">5 аргументов</span> — и ты поймёшь, почему <span className="bl">эта платформа</span> тебе подходит</h1>
          <Chat msgs={HELLO} className="hero-chat" autoStart onDone={onDone} />
          <motion.div
            className="chat-actions"
            initial={anim ? { opacity: 0, y: 10 } : false}
            animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.4 }}
          >
            <a className="btn btn-p" href="#a1">Слушаю →</a>
            <a className="btn btn-g" href="#price">Сразу к цене</a>
          </motion.div>
        </div>
        <div className="hero-photo">
          <div className="hp-bg" />
          <svg className="hp-orbit" viewBox="0 0 400 200" aria-hidden="true">
            <ellipse cx="200" cy="100" rx="190" ry="70" transform="rotate(-18 200 100)" fill="none" stroke="#F28C28" strokeWidth="5" />
            <circle cx="362" cy="44" r="10" fill="#F28C28" />
          </svg>
          <img
            src={PHOTO.cutout.src}
            alt="Альмир Шавалеев — учитель физики и математики"
            width={PHOTO.cutout.w}
            height={PHOTO.cutout.h}
            fetchPriority="high"
            decoding="async"
          />
        </div>
      </div>
    </section>
  )
}
