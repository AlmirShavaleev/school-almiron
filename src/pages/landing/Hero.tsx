import { motion, useScroll, useTransform } from 'framer-motion'
import { Link } from 'react-router-dom'
import { EASE, useAnim } from './anim'
import { LINKS } from './links'
import { Mark } from './Brand'
import { Icon3D } from './Icon3D'

/** Плавающие формулы фона: [текст, left, top, задержка петли, размер]. */
const FLOATERS: Array<[string, string, string, number, number?]> = [
  ['F = ma', '4%', '16%', 0],
  ['p = mv', '44%', '8%', -2],
  ['x² − 5x + 6 = 0', '8%', '78%', -4],
  ['U = IR', '52%', '86%', -1],
  ['sin²α + cos²α = 1', '90%', '20%', -6],
  ['E = hν', '86%', '70%', -3],
  ['∫', '30%', '60%', -5, 30],
  ['→v', '70%', '46%', -7, 28],
]

/** Заголовок по словам; акцентная часть едет одним куском, как в прототипе. */
const TITLE: Array<{ t: string; accent?: boolean }> = [
  { t: 'Готовься' }, { t: 'к' }, { t: 'экзамену' },
  { t: 'по авторскому курсу', accent: true },
  { t: 'в' }, { t: 'своём' }, { t: 'темпе' },
]

const HIGHLIGHTS = [
  { ic: '▶', bg: undefined, b: 'Видеоконспект к каждому уроку', s: 'Коротко и по делу, можно пересмотреть' },
  { ic: '📝', bg: 'var(--or)', b: 'Пробник ЕГЭ каждый месяц', s: 'Полный вариант с баллами и разбором' },
  { ic: '🔓', bg: 'var(--good)', b: 'Темы открываются по мере прохождения', s: 'А не по календарю, как в других школах' },
]

const up = (delay: number) => ({
  initial: { opacity: 0, y: 34 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: EASE, delay },
})

/**
 * Первый экран. `photo` — фото автора: пока его нет, в карточке знак
 * «Орбита», вокруг него медленно вращается оранжевая орбита (мотив знака).
 */
export function Hero({ photo }: { photo?: string }) {
  const anim = useAnim()
  const a = (delay: number) => (anim ? up(delay) : {})
  // Ракета при прокрутке вниз чуть уходит вверх: первые 600 px прокрутки —
  // до −60 px. Только transform; без анимаций стоит на месте.
  const { scrollY } = useScroll()
  const rocketY = useTransform(scrollY, [0, 600], [0, -60], { clamp: true })

  return (
    <section className="hero" id="top">
      <div className="floaters" aria-hidden="true">
        {FLOATERS.map(([t, left, top, d, size], i) => (
          <motion.span
            key={t}
            className="fl"
            style={{ left, top, fontSize: size }}
            initial={anim ? { opacity: 0, scale: 0.6 } : { opacity: 0.16 }}
            animate={{ opacity: 0.16, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.3 + i * 0.12 }}
          >
            <span style={{ animationDelay: `${d}s` }}>{t}</span>
          </motion.span>
        ))}
      </div>
      <div className="wrap">
        <div>
          <motion.span className="eyebrow" {...a(0)}>ЕГЭ и ОГЭ · математика и физика</motion.span>
          <h1>
            {TITLE.map((w, i) => (
              <span key={i}>
                {i > 0 && ' '}
                <motion.span
                  className={w.accent ? 'w accent' : 'w'}
                  initial={anim ? { opacity: 0, y: 28 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: EASE, delay: i * 0.07 }}
                >
                  {w.t}
                </motion.span>
              </span>
            ))}
          </h1>
          <motion.p className="lead" {...a(0.1)}>
            Я Альмир, учитель физики и математики. Готовлю к ЕГЭ и ОГЭ и собрал курс, где учёл всё, на чём ученики теряют баллы: видеоконспекты, банк задач по каждому номеру, ДЗ с автопроверкой и пробник каждый месяц.
          </motion.p>
          <motion.div className="hero-ctas" {...a(0.2)}>
            <Link className="btn btn-p" to={LINKS.register}>Начать бесплатно →</Link>
            <Link className="btn btn-g" to={LINKS.diagnostics}>Хочу пройти диагностику</Link>
          </motion.div>
          <motion.div className="hero-meta" {...a(0.3)}>
            <span className="tag tag-blue">3 дня бесплатно</span>
            <span className="tag tag-blue">500 ₽ в месяц</span>
            <span className="tag tag-ok">Без годовых обязательств</span>
            <span className="tag tag-soon">Пробник каждый месяц</span>
          </motion.div>
        </div>
        <motion.div className="card author" {...a(0.2)}>
          <motion.div className="hero-rocket" style={anim ? { y: rocketY } : undefined}>
            <motion.div
              initial={anim ? { opacity: 0, x: -40, y: 40 } : false}
              animate={{ opacity: 1, x: 0, y: 0 }}
              transition={{ duration: 0.9, ease: EASE, delay: 0.35 }}
            >
              <Icon3D name="hero-rocket" size={170} eager inherit />
            </motion.div>
          </motion.div>
          <div className="ava-mark">
            <motion.div
              className="orbit"
              aria-hidden="true"
              initial={false}
              animate={anim ? { rotate: 360 } : undefined}
              transition={{ duration: 40, ease: 'linear', repeat: Infinity }}
            >
              <svg viewBox="0 0 200 160">
                <ellipse cx="100" cy="80" rx="96" ry="44" transform="rotate(-22 100 80)" fill="none" stroke="var(--or)" strokeWidth="2" strokeDasharray="6 7" opacity=".55" />
                <circle cx="186" cy="44" r="6" fill="var(--or)" />
              </svg>
            </motion.div>
            <motion.div
              initial={anim ? { scale: 0.6, rotate: -10 } : false}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.9, delay: 0.4, type: 'spring', bounce: 0.45 }}
            >
              {photo ? <img className="ava-img" src={photo} alt="Альмир, автор курса" width={108} height={108} /> : <Mark size={108} />}
            </motion.div>
          </div>
          <q>Не нужно ждать, пока откроют тему, и подстраиваться под вебинары в 19:00. Занимайся, когда удобно, — я прослежу, чтобы ты успел всё.</q>
          <small>Альмир, автор курса</small>
          <div className="hl-list">
            {HIGHLIGHTS.map((h, i) => (
              <motion.div
                key={h.b}
                className="hl"
                initial={anim ? { opacity: 0, x: 24 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.8 + i * 0.15 }}
              >
                <span className="hl-ic" style={h.bg ? { background: h.bg } : undefined}>{h.ic}</span>
                <div><b>{h.b}</b><small>{h.s}</small></div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
