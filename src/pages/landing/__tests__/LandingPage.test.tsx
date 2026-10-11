import { beforeAll, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LandingPage } from '@/pages/LandingPage'
import { initialUnlock, submitHomework } from '../unlockLogic'

/**
 * Smoke-тест лендинга (ЛЕНДИНГ_ТЗ.md §5): страница рендерится целиком,
 * блоки стоят в порядке прототипа, кнопки ведут туда, куда сказано в ТЗ,
 * интерактив (цена, FAQ, демо открытия уроков, лист ожидания) работает.
 */
// В jsdom нет IntersectionObserver, а whileInView/useInView на нём стоят.
// Заглушка сразу сообщает «элемент виден» — блоки доезжают до конечного вида.
beforeAll(() => {
  class VisibleObserver {
    private cb: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) { this.cb = cb }
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
    }
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
  globalThis.IntersectionObserver = VisibleObserver as unknown as typeof IntersectionObserver
})

function renderLanding() {
  return render(<MemoryRouter><LandingPage /></MemoryRouter>)
}

const hrefOf = (name: string | RegExp) =>
  screen.getAllByRole('link', { name }).map(a => a.getAttribute('href'))

describe('лендинг: рендер и ссылки', () => {
  it('рендерит все блоки в порядке прототипа', () => {
    renderLanding()
    const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)
    expect(headings).toEqual([
      'Вся подготовка — в одной системе',
      'Загляни внутрь платформы',
      '1 пробник ЕГЭ каждый месяц',
      'Понятно с первого дня, что делать дальше',
      'Уроки открываются по мере прохождения, а не по календарю',
      'Развёрнутые решения проверяют по критериям ФИПИ в течение 48 часов',
      'Знаешь свой балл до экзамена',
      'Начинаем с физики. Дальше — математика и ОГЭ',
      'Один тариф — всё включено',
      'Частые вопросы',
      'Зарегистрируйся и начни прямо сейчас',
    ])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Готовься к экзамену по авторскому курсу в своём темпе')
  })

  it('CTA регистрации ведут на /register, вход — на /login', () => {
    renderLanding()
    for (const name of ['Регистрация', 'Начать бесплатно →', 'Создать аккаунт →', 'Начать бесплатно', 'Зарегистрироваться', 'Начать с 3 бесплатных дней', 'Хочу пройти диагностику']) {
      expect(hrefOf(name)).toEqual(expect.arrayContaining(['/register']))
      expect(hrefOf(name).every(h => h === '/register')).toBe(true)
    }
    expect(hrefOf('Войти')).toEqual(['/login'])
    expect(hrefOf('У меня уже есть аккаунт')).toEqual(['/login'])
  })

  it('подписи «условные» на макетах на месте', () => {
    renderLanding()
    expect(screen.getAllByText(/Цифры условные/).length).toBe(3)
    expect(screen.getByText(/Макеты экранов/)).toBeTruthy()
  })
})

describe('лендинг: интерактив', () => {
  it('переключатель цены: месяц 500 ₽ ↔ год 4 800 ₽', async () => {
    renderLanding()
    const price = screen.getByTestId('price')
    expect(price.textContent).toContain('500')
    expect(price.textContent).toContain('/ месяц')
    fireEvent.click(screen.getByRole('tab', { name: /На год/ }))
    expect(price.textContent).toContain('/ год')
    expect(screen.getByText('400 ₽ в месяц — на 20% выгоднее')).toBeTruthy()
    await screen.findByText((_, el) => el?.getAttribute('data-testid') === 'price' && /4\s800/.test(el.textContent ?? ''), {}, { timeout: 3000 })
  })

  it('FAQ: вкладка «Родителям» и раскрытие ответа', () => {
    renderLanding()
    fireEvent.click(screen.getByRole('tab', { name: 'Родителям' }))
    const q = screen.getByRole('button', { name: /Вы гарантируете балл\?/ })
    expect(q.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(q)
    expect(q.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/честно гарантировать балл не может никто/)).toBeTruthy()
  })

  it('демо «Сдать ДЗ» закрывает урок и открывает следующий', () => {
    const { container } = renderLanding()
    const btn = screen.getAllByRole('button', { name: 'Сдать ДЗ' })[0]
    expect(container.querySelector('[data-k="0-0"]')?.getAttribute('data-state')).toBe('open')
    expect(container.querySelector('[data-k="0-2"]')?.getAttribute('data-state')).toBe('locked')
    fireEvent.click(btn)
    expect(container.querySelector('[data-k="0-0"]')?.getAttribute('data-state')).toBe('done')
    expect(container.querySelector('[data-k="0-2"]')?.getAttribute('data-state')).toBe('open')
  })

  it('лист ожидания благодарит и ничего не отправляет пустым', () => {
    renderLanding()
    const forms = screen.getAllByRole('textbox', { name: /Контакт для листа ожидания/ })
    expect(forms).toHaveLength(3)
    const form = forms[0].closest('form')!
    fireEvent.click(within(form).getByRole('button', { name: 'Ждать' }))
    expect(screen.getAllByRole('textbox', { name: /Контакт для листа ожидания/ })).toHaveLength(3)
    fireEvent.change(forms[0], { target: { value: '@student' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Ждать' }))
    expect(screen.getByText('Сообщим о запуске ✓')).toBeTruthy()
  })
})

describe('логика демо открытия уроков', () => {
  it('сначала в каждом разделе открыты два первых урока', () => {
    expect(initialUnlock()).toEqual([
      ['open', 'open', 'locked', 'locked', 'locked'],
      ['open', 'open', 'locked', 'locked'],
    ])
  })

  it('раздел целиком проходится, после чего кнопке нечего делать', () => {
    let st = initialUnlock()
    for (let i = 0; i < 4; i++) st = submitHomework(st, 1).next
    expect(st[1]).toEqual(['done', 'done', 'done', 'done'])
    expect(st[0]).toEqual(initialUnlock()[0])
    expect(submitHomework(st, 1).changed).toEqual([])
  })
})
