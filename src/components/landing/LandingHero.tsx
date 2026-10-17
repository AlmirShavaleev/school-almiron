import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDownRight, ArrowRight, CheckCircle2, MessageSquareText } from 'lucide-react'
import teacherPortrait from '../../assets/almir-teacher-portrait.webp'

export function LandingHero() {
  const reduce = useReducedMotion()
  return <section className="al-hero">
    <div className="al-hero-grid" />
    <motion.svg className="al-orbit" viewBox="0 0 900 650"><motion.path d="M20 480 C220 180 510 690 870 130" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, delay: 1.1 }} /></motion.svg>
    <span className="al-formula f-one">F = ma</span><span className="al-formula f-two">∫ v(t)dt</span>
    <div className="al-wrap al-hero-layout"><div className="al-hero-copy">
      <motion.span className="al-label" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Авторская платформа подготовки к ОГЭ и ЕГЭ</motion.span>
      <h1>{['Физика и математика', 'становятся понятными'].map((line, i) => <span className="al-title-line" key={line}><motion.span initial={reduce ? false : { y: '110%' }} animate={{ y: 0 }} transition={{ duration: .8, delay: .2 + i * .14, ease: [.22, 1, .36, 1] }}>{line}</motion.span></span>)}</h1>
      <motion.p initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .7 }}>Занятия с репетитором, домашние задания, проверка решений и весь прогресс ученика — в одной системе.</motion.p>
      <motion.div className="al-hero-actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .9 }}><motion.a className="al-btn" href="#diagnostic" whileHover={{ y: -3 }} whileTap={{ scale: .96 }}>Записаться на диагностику <ArrowRight /></motion.a><a className="al-btn al-btn--ghost" href="#platform">Посмотреть платформу <ArrowDownRight /></a></motion.div>
      <motion.div className="al-proof" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.05 }}><span><b>100+</b> учеников</span><span><b>с 2021</b> подготовка</span><span><b>до 96</b> баллов</span></motion.div>
    </div><motion.div className="al-hero-product" initial={reduce ? false : { opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .9, delay: .6 }}>
      <div className="al-teacher-photo al-teacher-photo--hero"><img src={teacherPortrait} width={955} height={1280} fetchPriority="high" alt="Преподаватель физики и математики Альмир Шавалеев" /></div>
      <motion.div className="al-float checked" initial={{ opacity: 0, x: 22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.15 }}><CheckCircle2 /><span><small>Домашнее задание №12</small><b>Проверено</b></span></motion.div>
      <motion.div className="al-float progress" initial={{ opacity: 0, x: -22 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.28 }}><small>Прогресс по физике</small><b>78%</b><i><em /></i></motion.div>
      <motion.div className="al-float goal" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.4 }}><small>Следующая цель</small><b>80+</b><svg viewBox="0 0 150 46"><motion.path d="M2 42 C30 40 32 22 55 27 S88 8 110 17 S132 3 148 5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.3, delay: 1.55 }} /></svg></motion.div>
      <motion.div className="al-float comment" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.5 }}><MessageSquareText /><span><small>Комментарий преподавателя</small><b>Верная логика. Проверь единицы.</b></span></motion.div><div className="al-next"><i /> Четверг · 18:00</div>
    </motion.div></div>
  </section>
}
