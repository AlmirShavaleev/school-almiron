import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LessonEventModal } from '@/components/student/course/LessonEventModal'
import type { LessonEvent } from '@/lib/lessonEvents'

// Модалка «Урок пройден / открыт следующий» (письмо 16.10): тексты макета, закрытие, фокус.
const next: LessonEvent = {
  kind: 'next', passed: { n: 1, title: 'Инерция' },
  next: { id: 't2', n: 2, title: 'Инертность', foot: 'открыт · без ДЗ', locked: false, moduleTitle: 'Динамика' },
}

function open(ev: LessonEvent) {
  const onClose = vi.fn()
  render(<MemoryRouter><LessonEventModal event={ev} onClose={onClose} hrefFor={id => `/my-course/g/topic/${id}`} /></MemoryRouter>)
  return onClose
}

describe('LessonEventModal', () => {
  it('1: «Урок 1 пройден», карточка урока 2, «Перейти к уроку 2» в фокусе', () => {
    open(next)
    const dlg = screen.getByRole('dialog', { name: 'Урок 1 пройден' })
    expect(dlg).toHaveTextContent('Открыт следующий урок — можно начинать.')
    expect(screen.getByTestId('lesson-event-card')).toHaveTextContent('Урок 2Инертностьоткрыт · без ДЗ')
    expect(screen.getByTestId('lesson-event-go')).toHaveTextContent('Перейти к уроку 2')
    expect(document.activeElement).toBe(screen.getByTestId('lesson-event-go'))
  })

  it('закрыть — Esc, «Позже», крестик, клик мимо', () => {
    const onClose = open(next)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('lesson-event-later'))
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    fireEvent.mouseDown(screen.getByTestId('lesson-event-scrim'))
    expect(onClose).toHaveBeenCalledTimes(4)
  })

  it('2: следующий по дате — «Повторить в тренировке» / «Закрыть»', () => {
    open({ kind: 'wait', passed: { n: 5, title: 'X' }, when: 'в понедельник',
      next: { id: 't6', n: 6, title: 'Третий закон', foot: '🔒 откроется пн 19 окт', locked: true, moduleTitle: 'Динамика' } })
    expect(screen.getByRole('dialog')).toHaveTextContent('Все открытые уроки раздела сделаны. Следующий урок откроется в понедельник.')
    expect(screen.getByTestId('lesson-event-go')).toHaveTextContent('Повторить в тренировке')
    expect(screen.getByTestId('lesson-event-later')).toHaveTextContent('Закрыть')
  })

  it('3: больше 4 новых — 3 строки и «ещё M»', () => {
    const l = (n: number) => ({ id: `t${n}`, n, title: `Урок ${n}`, foot: 'сдать ДЗ', locked: false, moduleTitle: 'Динамика' })
    open({ kind: 'opened', moduleTitle: 'Динамика', lessons: [6, 7, 8, 9, 10].map(l), nextDate: 'пн 26 окт' })
    const dlg = screen.getByRole('dialog', { name: 'Открылись 5 новых уроков' })
    expect(dlg).toHaveTextContent('Динамика · уроки 6–10. Следующие откроются пн 26 окт.')
    expect(dlg).toHaveTextContent('9–10 · ещё 2 урока')
    expect(screen.getByTestId('lesson-event-go')).toHaveTextContent('Начать с урока 6')
  })

  it('4: раздел пройден', () => {
    open({ kind: 'section', moduleTitle: 'Динамика', count: 29, nextModuleTitle: 'Законы сохранения',
      next: { id: 'x', n: 1, title: 'Импульс тела', foot: 'открыт', locked: false, moduleTitle: 'Законы сохранения' } })
    expect(screen.getByRole('dialog', { name: 'Раздел «Динамика» пройден' })).toHaveTextContent('29 из 29 уроков. Следующий раздел — «Законы сохранения».')
    expect(screen.getByTestId('lesson-event-go')).toHaveTextContent('Перейти к разделу')
  })
})
