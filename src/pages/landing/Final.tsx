import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Reveal } from './motion'
import { useAnim } from './anim'
import { LINKS } from './links'

const STEPS: Array<[string, string]> = [
  ['Регистрация', 'Почта или телефон — и ты внутри'],
  ['Диагностика', '15 минут, чтобы понять свой уровень'],
  ['Первый урок', 'Видеоконспект и задачи уже в тот же день'],
  ['Подписка — когда понравится', '500 ₽ в месяц или 4 800 ₽ за год'],
]

export function FinalCta() {
  const anim = useAnim()
  return (
    <section id="form">
      <div className="wrap">
        <Reveal className="cta">
          <div>
            <span className="eyebrow">Старт за минуту</span>
            <h2>Зарегистрируйся и начни прямо сейчас</h2>
            <p className="lead">Первые 3 дня — полный доступ бесплатно. Без карты, без заявок и без звонков менеджеров.</p>
            <div className="hero-ctas">
              <Link className="btn btn-p" to={LINKS.register}>Создать аккаунт →</Link>
              <Link className="btn btn-o" to={LINKS.login}>У меня уже есть аккаунт</Link>
            </div>
          </div>
          <div className="reg-steps">
            {STEPS.map(([b, s], i) => (
              <motion.div
                key={b}
                className="rs"
                initial={anim ? { opacity: 0, x: 30 } : false}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
              >
                <span>{i + 1}</span><div><b>{b}</b><small>{s}</small></div>
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
          <span>© Школа Almiron, 2026</span>
          <nav aria-label="Документы">
            <a href={LINKS.privacy}>Политика конфиденциальности</a><span aria-hidden="true">·</span>
            <a href={LINKS.offer}>Договор-оферта</a><span aria-hidden="true">·</span>
            <a href={LINKS.contacts}>Контакты</a>
          </nav>
        </div>
      </footer>
      <Link className="btn btn-p m-cta" to={LINKS.register}>Начать бесплатно</Link>
    </>
  )
}
