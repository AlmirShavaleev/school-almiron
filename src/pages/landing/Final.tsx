import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Chat, type Msg } from './Chat'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { LINKS } from './links'
import { Mark } from './Brand'
import { iconSrc, type IconName } from './icons'

const CHAT: Msg[] = [
  { text: 'Это были 6 аргументов. Ну что, убедил?' },
  { me: true, text: 'Хочу попробовать!' },
  { text: 'Регистрируйся — первые 3 дня бесплатно, без карты. Начнём с диагностики.' },
]

/** Парящие иконки справа: [иконка, размер, позиция, задержка петли]. */
const FLOAT: Array<[IconName, number, React.CSSProperties, number]> = [
  ['rocket', 150, { left: '20%', top: '10%' }, 0],
  ['bot', 90, { right: '6%', top: '50%' }, -2],
  ['part2', 84, { left: 0, bottom: 0 }, -3],
]

/** Финальный диалог «Ну что, убедил?» + регистрация. */
export function FinalCta() {
  const anim = useAnim()
  return (
    <section id="final">
      <div className="wrap">
        <Reveal className="final">
          <div>
            <Chat msgs={CHAT} />
            <div className="chat-actions">
              <Link className="btn btn-o" to={LINKS.register}>Создать аккаунт →</Link>
              <Link className="btn btn-navy" to={LINKS.diagnostics}>Пройти диагностику</Link>
            </div>
          </div>
          <div className="final-ic" aria-hidden="true">
            {FLOAT.map(([ic, size, pos, d], i) => (
              <motion.div
                key={ic}
                className="fl"
                style={{ width: size, height: size, ...pos }}
                initial={anim ? { opacity: 0, scale: 0.4, rotate: -20 } : false}
                whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.7, delay: i * 0.2 }}
              >
                <div className="bob" style={{ width: '100%', height: '100%', animationDelay: `${d}s` }}>
                  <img src={iconSrc(ic)} alt="" width={size} height={size} loading="lazy" decoding="async" />
                </div>
              </motion.div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function Footer() {
  return (
    <>
      <footer>
        <div className="wrap">
          <span className="brand"><Mark size={28} />© Школа Almiron, 2026</span>
          <nav aria-label="Документы">
            <a href={LINKS.privacy}>Политика конфиденциальности</a><span aria-hidden="true">·</span>
            <a href={LINKS.offer}>Договор-оферта</a><span aria-hidden="true">·</span>
            <a href={LINKS.contacts}>Контакты</a>
          </nav>
        </div>
      </footer>
      <Link className="btn btn-p m-cta" to={LINKS.register}>3 дня бесплатно</Link>
    </>
  )
}
