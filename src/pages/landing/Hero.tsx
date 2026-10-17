import { motion } from 'framer-motion'
import { useCallback, useState } from 'react'
import { preload } from 'react-dom'
import headFont from './fonts/manrope-head-800.woff2?url'
import { Chat, type Msg } from './Chat'
import { useAnim } from './anim'
import { SCENES } from './icons'

const HELLO: Msg[] = [
  { text: <>Привет! Меня зовут <b>Альмир Шавалеев</b>.</> },
  { text: 'Я учитель физики и математики и много лет готовлю учеников к экзаменам.' },
  { text: 'Всё, что реально помогает сдать экзамен, я собрал на своей платформе. Разреши за 6 аргументов убедить тебя, что она тебе подходит.' },
  { me: true, text: 'Ну давай, убеди 🙂' },
]

/**
 * Первый экран: слева заголовок и диалог (аватар — фото владельца), справа
 * с правки 4 — картинка с закатом («Keep going», кружка) в скруглённой
 * рамке вместо вырезанного фото. 3D-иконок нет, движется только диалог;
 * картинка — LCP, грузится сразу с высоким приоритетом.
 */
export function Hero() {
  // Шрифт заголовка (`Manrope Head`, см. landing.css) — заранее, чтобы чаще
  // успевал к первой отрисовке. React кладёт <link rel="preload"> в <head> и
  // не дублирует его между рендерами.
  preload(headFont, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' })
  const anim = useAnim()
  const [ready, setReady] = useState(!anim)
  const onDone = useCallback(() => setReady(true), [])

  return (
    <section className="hero" id="top">
      <div className="wrap">
        <div>
          <div className="hero-name">Подготовка к ЕГЭ и ОГЭ · физика и математика</div>
          <h1>Дай мне <span className="or">6 аргументов</span> — и ты поймёшь, почему <span className="bl">эта платформа</span> тебе подходит</h1>
          <Chat msgs={HELLO} className="hero-chat" autoStart onDone={onDone} />
          <motion.div
            className="chat-actions"
            initial={anim ? { opacity: 0, y: 10 } : false}
            animate={ready ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.4 }}
          >
            <a className="btn btn-p" href="#cozy">Слушаю →</a>
            <a className="btn btn-g" href="#price">Сразу к цене</a>
          </motion.div>
        </div>
        <div className="hero-photo">
          <figure className="hero-sun">
            <img
              src={SCENES.sunset.src}
              alt="Рабочий стол на закате: кружка, блокнот и надпись Keep going"
              width={SCENES.sunset.w}
              height={SCENES.sunset.h}
              fetchPriority="high"
              decoding="async"
            />
          </figure>
        </div>
      </div>
    </section>
  )
}
