import { GraduationCap } from 'lucide-react'
import teacherPortrait from '../../assets/almir-teacher-portrait.webp'
import { MotionReveal } from './MotionReveal'

export function TeacherSection() {
  return <section className="al-teacher" id="teacher"><div className="teacher-geometry">π</div><div className="al-wrap teacher-layout">
    <MotionReveal direction="left" className="teacher-visual"><div className="al-teacher-photo al-teacher-photo--section"><img src={teacherPortrait} width={955} height={1280} loading="lazy" alt="Альмир Шавалеев — преподаватель физики и математики" /></div><div className="teacher-badge"><GraduationCap /><span><b>МГТУ им. Н. Э. Баумана</b>Выпускник</span></div></MotionReveal>
    <MotionReveal direction="right" className="teacher-copy"><span className="al-label dark">Преподаватель и автор платформы</span><h2>Объясняю логику,<br />а не заставляю<br />заучивать</h2><h3>Альмир Шавалеев</h3><p>Преподаватель физики и математики, выпускник МГТУ имени Н. Э. Баумана. Готовит к ОГЭ и ЕГЭ с 2021 года.</p><div className="principles">{['Сначала смысл задачи', 'Затем — физический закон', 'После — формула и расчёт'].map((x, i) => <span key={x}><b>0{i + 1}</b>{x}</span>)}</div></MotionReveal>
  </div></section>
}
