import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useInView } from 'framer-motion'
import { useAnim } from '@/pages/landing/anim'
import { Sticker } from '@/components/student/skin/Sticker'
import type { StickerName } from '@/components/student/skin/skin'
import { continueHref, type HomeContinue } from '@/lib/studentHomeCourses'

/**
 * Шаги урока — как аргумент 3 лендинга «Вся подготовка — в одной системе».
 * Отметок «просмотрено/прочитано» по шагам у главной нет (и запроса за ними
 * не добавляем), поэтому шаги — карта урока, а не прогресс: выделено одно,
 * что известно точно, — ДЗ этой темы ещё не сдано.
 */
const STEPS: Array<{ icon: StickerName; title: string; hint: string; kind?: 'now' | 'lock' }> = [
  { icon: 'play', title: 'Видеоконспект', hint: 'коротко и по делу' },
  { icon: 'book', title: 'Теория', hint: 'формулы и ловушки' },
  { icon: 'target', title: 'Задачи', hint: 'по номерам экзамена' },
  { icon: 'check', title: 'ДЗ', hint: 'ждёт сдачи', kind: 'now' },
  { icon: 'lock', title: 'Что дальше', hint: 'следующая тема', kind: 'lock' },
]

/**
 * «Продолжить урок» — одна заметная карточка на главной: следующая открытая
 * тема с несданным ДЗ (student_home_courses().continue). Подпись курса —
 * курсов бывает два. Линия под шагами заполняется, шаги выпрыгивают по
 * очереди (один раз, при появлении в экране; при «уменьшить движение» —
 * сразу в конечном виде).
 */
export function ContinueLessonCard({ groupId, courseTitle, next }: { groupId: string; courseTitle: string; next: HomeContinue }) {
  const anim = useAnim()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.35 })
  const run = inView || !anim
  const to = continueHref(groupId, next)

  return (
    <section className="stu-card stu-lesson" data-testid="continue-lesson" aria-labelledby="home-lesson-h">
      <div className="stu-lesson-head">
        <div className="min-w-0">
          <span className="stu-kicker block truncate">Продолжить урок · {courseTitle}</span>
          <h2 id="home-lesson-h" className="stu-h2 break-words">{next.title}</h2>
          {next.moduleTitle && <span className="stu-muted block text-[14px]">{next.moduleTitle}</span>}
        </div>
        <Link to={to} className="stu-btn stu-btn-o" data-testid="continue-lesson-open">К уроку →</Link>
      </div>

      <div className="stu-flow" ref={ref} role="list" aria-label="Шаги урока">
        <div className="stu-flow-line" aria-hidden="true">
          {/* scale по обеим осям: на компьютере линия растёт слева, на
              телефоне (вертикальная) — сверху; толщина 3px не заметна. */}
          <motion.div
            className="stu-flow-fill"
            initial={anim ? { scale: 0 } : false}
            animate={run ? { scale: 1 } : { scale: 0 }}
            transition={{ duration: 1.6, ease: 'easeInOut' }}
          />
        </div>
        {STEPS.map((s, i) => (
          <motion.div
            key={s.title}
            role="listitem"
            className={s.kind === 'lock' ? 'stu-step is-lock' : 'stu-step'}
            initial={anim ? { opacity: 0, y: 20, scale: 0.85 } : false}
            animate={run ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 20, scale: 0.85 }}
            transition={{ delay: anim ? i * 0.25 : 0, duration: 0.5 }}
          >
            <Sticker name={s.icon} size={80} />
            <span className="flex flex-col items-center gap-1 max-[760px]:items-start">
              <b>{s.title}</b>
              {s.kind === 'now'
                ? <span className="stu-tag t-or">{s.hint}</span>
                : <small>{s.hint}</small>}
            </span>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
