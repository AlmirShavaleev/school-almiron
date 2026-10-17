import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { lessonNumbers, openedTitle, type EventLesson, type LessonEvent } from '@/lib/lessonEvents'
import { plural } from '@/lib/plural'

/**
 * Модалка «Урок пройден / открыт следующий» (письмо ЛК_стиль_модалка_открыт_урок.md,
 * 16.10; тексты — из макета MNVKGAgPBCcKz86H5tXZnk). Что показать, решает
 * `lib/lessonEvents.ts`. Закрыть — крестик, «Позже», клик мимо, Esc. Фокус
 * внутри диалога; на телефоне — лист снизу, кнопки во всю ширину.
 *
 * Рисуется на месте, без портала: переменные цвета живут на корне `.stu`.
 */
function Card({ l, showModule }: { l: EventLesson; showModule?: boolean }) {
  return (
    <div className={l.locked ? 'stu-ev-card is-locked' : 'stu-ev-card'} data-testid="lesson-event-card">
      <span className="stu-ev-tn">{showModule ? `${l.moduleTitle} · урок ${l.n}` : `Урок ${l.n}`}</span>
      <span className="stu-ev-tt">{l.title}</span>
      <span className="stu-ev-st">{l.foot}</span>
    </div>
  )
}

export function LessonEventModal({ event, onClose, hrefFor }: {
  event: LessonEvent
  onClose: () => void
  hrefFor: (topicId: string) => string
}) {
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)
  const primary = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    primary.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key !== 'Tab' || !box.current) return
      const f = [...box.current.querySelectorAll<HTMLElement>('button, a[href]')]
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])

  const go = (to: string) => { onClose(); navigate(to) }

  let badge = '✓', blue = false, title = '', sub = '', body: React.ReactNode = null
  let action: { label: string; to: string } | null = null
  let later = 'Позже'

  switch (event.kind) {
    case 'next':
      title = `Урок ${event.passed.n} пройден`
      sub = 'Открыт следующий урок — можно начинать.'
      body = <Card l={event.next} />
      action = { label: `Перейти к уроку ${event.next.n}`, to: hrefFor(event.next.id) }
      break
    case 'wait':
      title = `Урок ${event.passed.n} пройден`
      sub = `Все открытые уроки раздела сделаны. ${event.when ? `Следующий урок откроется ${event.when}.` : 'Следующий урок пока закрыт.'}`
      body = <Card l={event.next} />
      action = { label: 'Повторить в тренировке', to: '/catalog' }
      later = 'Закрыть'
      break
    case 'opened': {
      const k = event.lessons.length
      badge = '🔓'; blue = true
      title = openedTitle(k)
      sub = `${event.moduleTitle} · ${lessonNumbers(event.lessons.map(l => l.n))}.${event.nextDate ? ` Следующие откроются ${event.nextDate}.` : ''}`
      const shown = k > 4 ? event.lessons.slice(0, 3) : event.lessons
      const more = k - shown.length
      body = (
        <div className="stu-ev-list">
          {shown.map(l => <div key={l.id} className="stu-ev-card"><span className="stu-ev-tt">{l.n} · {l.title}</span></div>)}
          {more > 0 && (
            <div className="stu-ev-card">
              <span className="stu-ev-tt">{lessonNumbers(event.lessons.slice(3).map(l => l.n)).replace(/^уроки? /, '')} · ещё {more} {plural(more, 'урок', 'урока', 'уроков')}</span>
            </div>
          )}
        </div>
      )
      action = { label: `Начать с урока ${event.lessons[0].n}`, to: hrefFor(event.lessons[0].id) }
      break
    }
    case 'section':
      badge = '🏁'
      title = `Раздел «${event.moduleTitle}» пройден`
      sub = `${event.count} из ${event.count} ${plural(event.count, 'урока', 'уроков', 'уроков')}.${event.nextModuleTitle ? ` Следующий раздел — «${event.nextModuleTitle}».` : ''}`
      body = event.next ? <Card l={event.next} showModule /> : null
      action = event.next ? { label: 'Перейти к разделу', to: hrefFor(event.next.id) } : null
      break
  }

  return (
    <div className="stu-ev-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }} data-testid="lesson-event-scrim">
      <div ref={box} className="stu-ev-modal" role="dialog" aria-modal="true" aria-labelledby="lesson-event-title" data-testid="lesson-event" data-kind={event.kind}>
        <button type="button" className="stu-ev-x" aria-label="Закрыть" onClick={onClose}><X size={18} /></button>
        <div className={blue ? 'stu-ev-badge is-blue' : 'stu-ev-badge'} aria-hidden>{badge}</div>
        <h2 id="lesson-event-title" className="stu-ev-h">{title}</h2>
        <p className="stu-muted">{sub}</p>
        {body}
        <div className="stu-ev-acts">
          {action && (
            <button ref={primary} type="button" className="stu-btn stu-btn-p" onClick={() => go(action!.to)} data-testid="lesson-event-go">{action.label}</button>
          )}
          <button ref={action ? undefined : primary} type="button" className="stu-btn stu-btn-g" onClick={onClose} data-testid="lesson-event-later">{later}</button>
        </div>
      </div>
    </div>
  )
}
