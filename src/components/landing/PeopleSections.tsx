import { motion } from 'framer-motion'
import { Activity, MessageSquareText } from 'lucide-react'
import { MotionReveal } from './MotionReveal'

export function ParentsSection() {
  return <section className="al-parents"><div className="al-wrap parents-layout">
    <MotionReveal direction="left"><span className="al-label">Кабинет родителя</span><h2>Родители видят<br />не обещания,<br />а реальный прогресс</h2><p>Посещаемость, задания, пробники и рекомендации — без необходимости постоянно спрашивать ребёнка.</p></MotionReveal>
    <MotionReveal direction="right" className="parent-ui"><header><div><small>Прогресс Михаила</small><b>ЕГЭ · физика</b></div><em><i /> Обновлено сегодня</em></header><div className="parent-stats"><article><small>Посещаемость</small><b>92%</b><motion.i initial={{ width: 0 }} whileInView={{ width: '92%' }} viewport={{ once: true }} /></article><article><small>Домашние задания</small><b>18 / 20</b><motion.i initial={{ width: 0 }} whileInView={{ width: '90%' }} viewport={{ once: true }} /></article><article className="exam"><small>Последний пробник</small><b>74</b><span>+8 за 2 месяца</span></article></div><div className="parent-chart"><div><span>Динамика по темам</span><b>+14%</b></div><svg viewBox="0 0 520 130"><motion.path d="M0 112 C60 115 75 75 135 89 S220 45 275 60 S360 20 420 34 S475 9 520 12" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.4 }} /></svg></div><div className="parent-history"><Activity /><span><b>Механика: 82%</b><small>рост на 6% после работы над ошибками</small></span><MessageSquareText /><span><b>Рекомендация преподавателя</b><small>Повторить электродинамику до четверга</small></span></div></MotionReveal>
  </div></section>
}
