import { describe, expect, it } from 'vitest'
import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { Input, Select } from '@/components/ui/Input'

/**
 * Хвост §130. Подпись у Input/Select рисовалась отдельным <label> без htmlFor и
 * поле собой не оборачивала. Следствий два, и оба тихие:
 *  • скринридер называл поле без имени;
 *  • ЛЮБОЙ тест, искавший поле по подписи, отдавал null независимо от того,
 *    есть поле на экране или нет — проверка «поля не должно быть» была
 *    зелёной всегда.
 * Поэтому проверки ниже — про саму связь, а не про разметку.
 */
describe('Input: подпись связана с полем', () => {
  it('поле находится по подписи', () => {
    render(<Input label="ФИО" placeholder="Иванов Иван" />)
    expect(screen.getByLabelText('ФИО')).toBe(screen.getByPlaceholderText('Иванов Иван'))
  })

  // Именно `input.labels` читает браузер: отсюда и имя для скринридера, и
  // перевод фокуса по клику на подпись. Сам клик тут не проверяем — jsdom
  // фокус по метке не эмулирует, проверка была бы про jsdom, а не про код.
  it('поле знает свою подпись (input.labels)', () => {
    render(<Input label="Почта" />)
    const field = screen.getByLabelText('Почта') as HTMLInputElement
    expect(Array.from(field.labels ?? []).map(l => l.textContent)).toEqual(['Почта'])
  })

  it('переданный снаружи id уважается, свой не подставляется', () => {
    render(<Input label="Телефон" id="phone-field" />)
    const field = screen.getByLabelText('Телефон')
    expect(field).toHaveAttribute('id', 'phone-field')
  })

  it('два поля с одинаковой подписью получают разные id', () => {
    render(
      <>
        <Input label="Балл" placeholder="первое" />
        <Input label="Балл" placeholder="второе" />
      </>
    )
    const [first, second] = screen.getAllByLabelText('Балл')
    expect(first.id).not.toBe('')
    expect(first.id).not.toBe(second.id)
  })

  it('без подписи <label> не рисуется, остальные пропсы и ref живы', () => {
    const ref = createRef<HTMLInputElement>()
    const { container } = render(<Input ref={ref} placeholder="Поиск" disabled />)
    expect(container.querySelector('label')).toBeNull()
    expect(ref.current).toBe(screen.getByPlaceholderText('Поиск'))
    expect(screen.getByPlaceholderText('Поиск')).toBeDisabled()
  })

  it('aria-label извне остаётся именем поля', () => {
    render(<Input label="Балл" aria-label="Балл за работу" />)
    expect(screen.getByLabelText('Балл за работу')).toBeInTheDocument()
  })
})

describe('Select: подпись связана с полем', () => {
  const OPTIONS = [
    { value: 'ege', label: 'ЕГЭ' },
    { value: 'oge', label: 'ОГЭ' },
  ]

  it('список находится по подписи и меняется', () => {
    render(<Select label="Экзамен" options={OPTIONS} defaultValue="ege" />)
    const field = screen.getByLabelText('Экзамен') as HTMLSelectElement
    fireEvent.change(field, { target: { value: 'oge' } })
    expect(field.value).toBe('oge')
  })

  it('переданный снаружи id уважается', () => {
    render(<Select label="Экзамен" options={OPTIONS} id="exam-field" />)
    expect(screen.getByLabelText('Экзамен')).toHaveAttribute('id', 'exam-field')
  })
})
