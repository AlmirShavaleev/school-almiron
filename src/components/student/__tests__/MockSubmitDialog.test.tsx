/**
 * §230. Окно «Закончить пробник раньше времени?» — на весь экран: на телефоне
 * непрозрачный слой (страницы под ним не видно), на ноутбуке — затемнение на
 * весь экран и карточка по центру. Закрывается «Вернуться к работе», крестиком,
 * Esc и системным «назад» (своя запись в истории; закрыли иначе — запись
 * убирается, следующее «назад» уводит со страницы как обычно).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { MockSubmitDialog } from '@/components/student/MockSubmitDialog'

const PHOTOS_UNTIL = new Date(Date.now() + 90 * 60_000).toISOString()

function Harness({ onConfirm = async () => ({ error: null }) }: { onConfirm?: () => Promise<{ error: string | null }> }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Сдать работу</button>
      {open && (
        <MockSubmitDialog
          open
          onClose={() => setOpen(false)}
          onConfirm={async () => { const r = await onConfirm(); if (!r.error) setOpen(false); return r }}
          leftMs={72 * 60_000 + 5_000}
          photosUntil={PHOTOS_UNTIL}
          part1={12}
          filled={11}
          empty={[7]}
          photos={3}
          broken={[]}
          part2Range="13–19"
        />
      )}
    </>
  )
}

const ours = () => !!(window.history.state as Record<string, unknown> | null)?.mockSubmitDialog

afterEach(async () => {
  // Ничего не оставлять в истории jsdom между тестами (back() в jsdom — асинхронный).
  for (let i = 0; i < 5 && ours(); i++) {
    window.history.back()
    await new Promise(r => setTimeout(r, 20))
  }
})

describe('окно сдачи пробника (§230)', () => {
  it('на весь экран: слой на весь вьюпорт, на телефоне непрозрачный; role=dialog, aria-modal, содержимое прежнее', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Сдать работу'))
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveAttribute('aria-modal', 'true')
    expect(dlg).toHaveAccessibleName('Закончить пробник раньше времени?')
    // Слой — прямо в body, на весь экран; фон телефона — белый (страницу не видно),
    // с sm — затемнение; сама карточка на телефоне во всю высоту и ширину.
    const scrim = screen.getByTestId('mock-lesson-dialog-scrim')
    expect(scrim.parentElement).toBe(document.body)
    expect(scrim.className).toMatch(/(^| )fixed( |$)/)
    expect(scrim.className).toMatch(/(^| )inset-0( |$)/)
    expect(scrim.className).toMatch(/(^| )bg-white( |$)/)
    expect(scrim.className).toContain('sm:bg-[rgba(14,31,71')
    expect(dlg.className).toMatch(/(^| )h-full( |$)/)
    expect(dlg.className).toMatch(/(^| )w-full( |$)/)
    expect(dlg).toHaveTextContent('До конца ещё 1 ч 12 мин')
    expect(dlg).toHaveTextContent('Бланк: 11 из 12')
    expect(dlg).toHaveTextContent('Фото второй части: 3')
    expect(dlg).toHaveTextContent('Пустой ответ №7 засчитается как нерешённый.')
    expect(screen.getByTestId('mock-lesson-submit-yes')).toHaveTextContent('Да, сдать работу')
    expect(screen.getByTestId('mock-lesson-submit-back')).toHaveFocus()
    // Прокрутка страницы под окном заперта.
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('«назад» браузера закрывает окно, а не уводит со страницы', async () => {
    render(<Harness />)
    const opener = screen.getByText('Сдать работу')
    opener.focus()
    fireEvent.click(opener)
    expect(ours()).toBe(true)
    await act(async () => {
      window.history.back()
      await new Promise(r => setTimeout(r, 20))
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(ours()).toBe(false)
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByText('Сдать работу')).toHaveFocus()
  })

  it('«Вернуться к работе», крестик и Esc закрывают и убирают свою запись из истории', async () => {
    render(<Harness />)
    for (const close of [
      () => fireEvent.click(screen.getByTestId('mock-lesson-submit-back')),
      () => fireEvent.click(screen.getByTestId('mock-lesson-submit-close')),
      () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }),
    ]) {
      fireEvent.click(screen.getByText('Сдать работу'))
      expect(ours()).toBe(true)
      close()
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => expect(ours()).toBe(false))
    }
  })

  it('Tab не выходит из окна', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Сдать работу'))
    const dlg = screen.getByRole('dialog')
    const back = screen.getByTestId('mock-lesson-submit-back')
    // «Вернуться» — последняя в окне: Tab уводит на первую (крестик), Shift+Tab с неё — обратно.
    back.focus()
    fireEvent.keyDown(dlg, { key: 'Tab' })
    expect(screen.getByTestId('mock-lesson-submit-close')).toHaveFocus()
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true })
    expect(back).toHaveFocus()
  })

  it('«Да, сдать работу» сдаёт; ошибка — остаётся открытым и говорит почему', async () => {
    const confirm = vi.fn(async () => ({ error: 'Время вышло' }))
    render(<Harness onConfirm={confirm} />)
    fireEvent.click(screen.getByText('Сдать работу'))
    await act(async () => { fireEvent.click(screen.getByTestId('mock-lesson-submit-yes')) })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Время вышло')
  })
})
