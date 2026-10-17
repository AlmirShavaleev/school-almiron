import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Stagger } from '@/pages/landing/motion'
import { staggerItem } from '@/pages/landing/anim'
import { Sticker } from '@/components/student/skin/Sticker'
import type { StickerName } from '@/components/student/skin/skin'
import { continueHref, type HomeCourseProgress } from '@/lib/studentHomeCourses'

export interface CourseProgressItem {
  courseId: string
  groupId: string
  title: string
  subject: string | null
  /** null — прогресс ещё грузится или не пришёл: карточка без полосок. */
  progress: HomeCourseProgress | null
}

function Bar({ percent, label, thin }: { percent: number; label: string; thin?: boolean }) {
  return (
    <span
      className={thin ? 'stu-bar thin' : 'stu-bar'}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <i style={{ width: `${percent}%` }} />
    </span>
  )
}

/** Стикер карточки по предмету — один на карточку. */
function courseSticker(subject: string | null, i: number): StickerName {
  const s = (subject ?? '').toLowerCase()
  if (s.includes('физ') || s.includes('phys')) return 'rocket'
  if (s.includes('мат') || s.includes('math')) return 'calendar'
  return (['book', 'target', 'play'] as const)[i % 3]
}

/**
 * «Мои курсы» (письмо 14.10, стиль лендинга): карточка на курс — 3D-стикер,
 * общий % и полоски разделов — доля тем раздела с ДЗ, где ДЗ сдано или
 * принято (та же логика, что «ДЗ принято X из Y»), — и «Продолжить». Курс,
 * в котором «Продолжить урок» наверху, выделен синей рамкой.
 */
export function CourseProgressCard({ items, mainCourseId }: { items: CourseProgressItem[]; mainCourseId?: string | null }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="home-courses-h" data-testid="courses-card" className="flex flex-col gap-4">
      <div>
        <span className="stu-kicker">Прогресс по ДЗ</span>
        <h2 id="home-courses-h" className="stu-h2">Мои курсы</h2>
      </div>
      <Stagger className="stu-courses">
        {items.map((c, i) => {
          const p = c.progress
          const main = c.courseId === mainCourseId
          return (
            <motion.article
              key={c.courseId}
              variants={staggerItem}
              data-testid="home-course"
              className={main ? 'stu-card stu-course is-main' : 'stu-card stu-course'}
            >
              <div className="flex items-start justify-between gap-3">
                <Sticker name={courseSticker(c.subject, i)} size={64} />
                {p && p.total > 0 && (
                  <span className="text-right">
                    <b className="stu-pct block" data-testid="course-percent">{p.percent}%</b>
                    <span className="stu-muted text-[12.5px]">{p.done} из {p.total} тем</span>
                  </span>
                )}
              </div>
              <Link to={`/my-course/${c.groupId}`} className="stu-h3 stu-focus break-words hover:text-[var(--blueInk)]">
                {c.title}
              </Link>
              {p && p.total > 0 && <Bar percent={p.percent} label={`${c.title}: ДЗ сдано по темам`} />}
              {p && p.modules.length > 0 && (
                <ul className="stu-mods" aria-label="Разделы">
                  {p.modules.map(m => (
                    <li key={m.moduleId} data-testid="home-module">
                      <span>
                        <span className="stu-muted min-w-0 break-words">{m.title}</span>
                        <b className="shrink-0 tabular-nums">{m.percent}%</b>
                      </span>
                      <Bar thin percent={m.percent} label={`${m.title}: ${m.done} из ${m.total} тем с ДЗ сдано`} />
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to={continueHref(c.groupId, p?.next ?? null)}
                className={main ? 'stu-btn stu-btn-p mt-auto' : 'stu-btn stu-btn-g mt-auto'}
              >
                Продолжить
              </Link>
            </motion.article>
          )
        })}
      </Stagger>
    </section>
  )
}
