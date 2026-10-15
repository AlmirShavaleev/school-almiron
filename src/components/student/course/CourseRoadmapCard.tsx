import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Lock } from 'lucide-react'
import { Sticker } from '@/components/student/skin/Sticker'
import { buildRoadmap, type RoadmapModule, type RoadmapModuleIn } from '@/lib/courseRoadmap'

const PILL: Record<'done' | 'hw' | 'open', [string, string]> = {
  done: ['stu-pill p-ok', 'пройдено'],
  hw: ['stu-pill p-hw', 'сдать ДЗ'],
  open: ['stu-pill p-open', 'открыто'],
}

function ModulePill({ m }: { m: RoadmapModule }) {
  if (m.state === 'done') return <span className="stu-pill p-ok">готово</span>
  if (m.hwToDo > 0) return <span className="stu-pill p-hw">{m.hwToDo} ДЗ</span>
  if (m.state === 'locked') return <span className="stu-pill p-lock">закрыт</span>
  return null
}

/**
 * «Календарь тем» в программе курса (письмо 15.10, вариант «А» —
 * дорожка по разделам): кольцо «пройдено N из M» у раздела, текущий
 * развёрнут, остальные раскрываются по клику; у темы — «пройдено» /
 * «сдать ДЗ» / «открыто» / замок с условием. Пробный период — внизу
 * «Оформить подписку». Правила — src/lib/courseRoadmap.ts.
 */
export function CourseRoadmapCard({ modules, groupId, demo, onShowAll }: {
  modules: RoadmapModuleIn[]
  groupId: string
  demo: boolean
  onShowAll?: () => void
}) {
  const roadmap = useMemo(() => buildRoadmap(modules), [modules])
  const currentId = roadmap.find(m => m.state === 'current')?.id ?? null
  const [open, setOpen] = useState<Set<string>>(() => new Set(currentId ? [currentId] : []))
  if (roadmap.length === 0) return null
  const toggle = (id: string) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <section className="stu-card stu-roadmap" aria-labelledby="roadmap-h" data-testid="course-roadmap">
      <div className="flex items-center gap-3">
        <Sticker name="calendar25" size={52} />
        <div className="min-w-0">
          <h2 id="roadmap-h" className="stu-h3">Календарь тем</h2>
          <span className="stu-muted text-[14px]">где ты сейчас и что откроется дальше</span>
        </div>
      </div>

      <ol className="stu-rsecs">
        {roadmap.map(m => {
          const expanded = open.has(m.id)
          return (
            <li key={m.id} className={m.state === 'current' ? 'stu-rsec is-current' : 'stu-rsec'} data-testid="roadmap-module" data-state={m.state}>
              <button
                type="button"
                className="stu-rsec-head stu-focus"
                aria-expanded={expanded}
                onClick={() => toggle(m.id)}
              >
                <span className="stu-ring" style={{ ['--p' as string]: m.percent }} aria-label={`пройдено ${m.done} из ${m.total}`}>
                  <span>{m.done}/{m.total}</span>
                </span>
                <span className="min-w-0 text-left">
                  <b className="block break-words text-[15px]">{m.title}</b>
                  <span className="stu-muted block text-[13px]">{m.meta}</span>
                </span>
                <span className="flex items-center gap-2">
                  <ModulePill m={m} />
                  <ChevronDown size={18} aria-hidden className={expanded ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </span>
              </button>
              {expanded && (
                <div className="stu-rsec-body">
                  {m.done > 0 && <p className="stu-muted text-[13px]">пройдено тем: {m.done}</p>}
                  {m.visible.map(t => t.state === 'locked' ? (
                    <div key={t.id} className="stu-rm-locked" data-testid="roadmap-topic" data-state="locked">
                      <Lock size={15} aria-hidden className="mt-[3px] shrink-0" />
                      <span className="min-w-0">
                        <span className="block break-words">{t.title}</span>
                        <small className="block">{t.note}</small>
                      </span>
                    </div>
                  ) : (
                    <Link
                      key={t.id}
                      to={`/my-course/${groupId}/topic/${t.id}`}
                      className={t.state === 'hw' ? 'stu-rm-row is-hw stu-focus' : 'stu-rm-row stu-focus'}
                      data-testid="roadmap-topic"
                      data-state={t.state}
                    >
                      <span className="min-w-0 break-words">{t.title}</span>
                      <span className={PILL[t.state][0]}>{PILL[t.state][1]}</span>
                    </Link>
                  ))}
                  {m.moreLocked > 0 && <p className="stu-muted text-[13px]">и ещё закрытых: {m.moreLocked}</p>}
                  {m.visible.length === 0 && m.done === 0 && <p className="stu-muted text-[13px]">тем пока нет</p>}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-4">
        {onShowAll
          ? <button type="button" className="stu-link stu-focus" onClick={onShowAll}>Вся программа ↓</button>
          : <span />}
        {demo && <Link to="/courses" className="stu-btn stu-btn-o" data-testid="roadmap-subscribe">Оформить подписку</Link>}
      </div>
    </section>
  )
}
