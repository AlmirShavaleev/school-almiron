import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileChip } from '../FileChip'

const LONG = 'IMG_20260911_очень_длинное_имя_файла_с_телефона_1.jpg'

describe('FileChip', () => {
  it('показывает обрезанное имя, полное — в title', () => {
    render(<FileChip name={LONG} />)
    const nameEl = screen.getByTitle(LONG)
    expect(nameEl.textContent).not.toBe(LONG)
    expect(nameEl.textContent).toContain('…')
    expect(nameEl.textContent?.endsWith('_1.jpg')).toBe(true)
  })

  it('короткое имя выводит целиком', () => {
    render(<FileChip name="photo.jpg" />)
    expect(screen.getByTitle('photo.jpg').textContent).toBe('photo.jpg')
  })

  it('не может стать шире родителя: max-w-full и truncate', () => {
    render(<FileChip name={LONG} />)
    const chip = screen.getByTestId('file-chip')
    expect(chip.className).toContain('max-w-full')
    expect(chip.className).toContain('min-w-0')
    expect(screen.getByTitle(LONG).className).toContain('truncate')
  })

  it('рисует слоты по краям', () => {
    render(<FileChip name="a.pdf" leading={<i data-testid="lead" />} trailing={<b>без разметки</b>} />)
    expect(screen.getByTestId('lead')).toBeTruthy()
    expect(screen.getByText('без разметки')).toBeTruthy()
  })
})
