import { motion } from 'framer-motion'
import { featureItems } from './data'
import { MotionReveal } from './MotionReveal'

export function FeaturesGrid() {
  return <section className="al-features"><div className="al-wrap"><MotionReveal className="al-section-head"><span className="al-label">Продукт внутри обучения</span><h2>Всё, что помогает<br />не терять темп</h2><p>Не набор рекламных обещаний, а рабочие инструменты ученика, преподавателя и родителя.</p></MotionReveal><div className="bento">{featureItems.map(({ icon: Icon, title, text, kind }, i) => <motion.article className={`bento-card bento-${kind}`} key={title} initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .2 }} transition={{ delay: (i % 4) * .07 }} whileHover={{ y: -5 }}><div className="bento-icon"><Icon /></div><h3>{title}</h3><p>{text}</p>{kind === 'progress' && <div className="topic-bars"><span><i style={{ width: '82%' }} />82%</span><span><i style={{ width: '67%' }} />67%</span></div>}{kind === 'comment' && <blockquote>«Решение верное. Обоснуй переход во второй строке»</blockquote>}{kind === 'exam' && <b className="big-metric">74<span>/100</span></b>}{kind === 'schedule' && <div className="mini-calendar"><b>18:00</b><span>Механика · 60 мин</span></div>}</motion.article>)}</div></div></section>
}
