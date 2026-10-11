import { beforeAll, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { LandingPage } from '@/pages/LandingPage'
import { initialUnlock, LESSONS, submitHomework } from '../unlockLogic'
import { ICONS, PHOTO, SCREENS } from '../icons'

/**
 * Smoke-тест лендинга, правка 3 (ЛЕНДИНГ_ПРАВКИ_3_диалог.md, эталон —
 * лендинг_прототип_v2.html): блоки в порядке прототипа, CTA ведут туда, куда
 * сказано в ТЗ, интерактив работает, ассеты на месте и с явными размерами.
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

describe('лендинг: структура и ссылки', () => {
  it('блоки в порядке прототипа v2', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toBe('Дай мне 5 аргументов — и ты поймёшь, почему эта платформа тебе подходит')
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Не репетитор и не урок-шоу',
      'Вся подготовка — в одной системе',
      'Темы открываются, когда ты готов',
      'Вторая часть — проверка с помощью ИИ',
      'Ты знаешь свой балл ещё до экзамена',
      'Так выглядит платформа',
      'Сколько стоит месяц подготовки',
      'Частые вопросы',
    ])
  })

  it('CTA регистрации ведут на /register, вход — на /login, якоря — на свои блоки', () => {
    const { container } = renderLanding()
    for (const name of ['Регистрация', 'Попробовать', 'Начать с 3 бесплатных дней', 'Создать аккаунт →', '3 дня бесплатно', 'Пройти диагностику']) {
      const hrefs = hrefOf(name)
      expect(hrefs.length, name).toBeGreaterThan(0)
      expect(hrefs.every(h => h === '/register'), name).toBe(true)
    }
    expect(hrefOf('Войти')).toEqual(['/login'])
    expect(hrefOf('Слушаю →')).toEqual(['#a1'])
    expect(hrefOf('Сразу к цене')).toEqual(['#price'])
    expect(hrefOf('Узнать цену →')).toEqual(['#price', '#price', '#price'])
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5', 'inside', 'price', 'faq', 'final']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
  })

  it('диалоги: весь текст в DOM сразу, реплики «Ты» подписаны', () => {
    renderLanding()
    expect(screen.getByText('Ну давай, убеди 🙂')).toBeTruthy()
    expect(screen.getByText('А кто проверит мои развёрнутые решения?')).toBeTruthy()
    expect(screen.getByText('Хочу попробовать!')).toBeTruthy()
    expect(screen.getAllByText('Ты').length).toBe(4)
  })

  it('подпись «Цифры условные» у счётчиков прогноза', () => {
    renderLanding()
    expect(screen.getByText(/Цифры условные, прогноз — оценка, а не гарантия/)).toBeTruthy()
  })
})

describe('лендинг: интерактив', () => {
  it('переключатель цены: месяц 500 ₽ ↔ год 4 800 ₽', async () => {
    renderLanding()
    const price = screen.getByTestId('price')
    expect(price.textContent).toContain('500')
    expect(price.textContent).toContain('/ месяц')
    fireEvent.click(screen.getByRole('tab', { name: 'Год −20%' }))
    expect(price.textContent).toContain('/ год')
    expect(screen.getByText('400 ₽ в месяц — на 20% выгоднее')).toBeTruthy()
    await screen.findByText((_, el) => el?.getAttribute('data-testid') === 'price' && /4\s800/.test(el.textContent ?? ''), {}, { timeout: 3000 })
  })

  it('FAQ раскрывает ответ', () => {
    renderLanding()
    const q = screen.getByRole('button', { name: /Как отменить подписку\?/ })
    expect(q.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(q)
    expect(q.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/В личном кабинете, в один клик/)).toBeTruthy()
  })

  it('демо «Сдать ДЗ» закрывает тему и открывает следующую', () => {
    const { container } = renderLanding()
    const state = (k: number) => container.querySelector(`[data-k="${k}"]`)?.getAttribute('data-state')
    expect([0, 1, 2].map(state)).toEqual(['open', 'open', 'locked'])
    fireEvent.click(screen.getByRole('button', { name: 'Сдать ДЗ →' }))
    expect([0, 1, 2].map(state)).toEqual(['done', 'open', 'open'])
  })

  it('вкладки платформы переключают скриншот', () => {
    const { container } = renderLanding()
    const visible = () => [...container.querySelectorAll('#lnd-shot img')].filter(i => i.getAttribute('aria-hidden') !== 'true')
    expect(visible().map(i => i.getAttribute('src'))).toEqual([SCREENS[0].src])
    act(() => { fireEvent.click(screen.getByRole('tab', { name: 'Банк задач' })) })
    expect(visible().map(i => i.getAttribute('src'))).toEqual([SCREENS[3].src])
    expect(screen.getByRole('tab', { name: 'Банк задач' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('логика демо открытия тем', () => {
  it('сначала открыты две первые темы раздела', () => {
    expect(initialUnlock()).toEqual(['open', 'open', 'locked', 'locked', 'locked'])
  })

  it('раздел проходится целиком, после этого кнопке нечего делать', () => {
    let st = initialUnlock()
    for (let i = 0; i < LESSONS.length; i++) st = submitHomework(st).next
    expect(st.every(s => s === 'done')).toBe(true)
    expect(submitHomework(st).changed).toEqual([])
  })

  it('замок качается, только когда открылась новая тема', () => {
    expect(submitHomework(initialUnlock()).unlocked).toBe(true)
    expect(submitHomework(['done', 'done', 'done', 'open', 'open']).unlocked).toBe(false)
  })
})

describe('ассеты (правка 3)', () => {
  const pub = (src: string) => resolve(process.cwd(), 'public', src.replace(/^\//, ''))

  it('у каждой иконки, фото и скриншота есть файл', () => {
    const files = [...ICONS.map(n => `/brand/icons/${n}.webp`), PHOTO.cutout.src, PHOTO.avatar.src, ...SCREENS.map(s => s.src)]
    expect(files.filter(f => !existsSync(pub(f)))).toEqual([])
  })

  it('на первом экране нет 3D-иконок; фото — сразу и с высоким приоритетом', () => {
    const { container } = renderLanding()
    const hero = container.querySelector('#top')!
    expect(hero.querySelector('img[src^="/brand/icons/"]')).toBeNull()
    const photo = hero.querySelector(`img[src="${PHOTO.cutout.src}"]`)!
    expect(photo.getAttribute('fetchpriority')).toBe('high')
    expect(photo.getAttribute('loading')).not.toBe('lazy')
  })

  it('у всех картинок явные размеры; иконки и скриншоты — lazy', () => {
    const { container } = renderLanding()
    const imgs = [...container.querySelectorAll('img')]
    for (const img of imgs) {
      expect(img.getAttribute('width'), img.getAttribute('src')!).toMatch(/^\d+$/)
      expect(img.getAttribute('height'), img.getAttribute('src')!).toMatch(/^\d+$/)
    }
    for (const img of imgs.filter(i => /\/brand\/(icons|screens)\//.test(i.getAttribute('src')!))) {
      expect(img.getAttribute('loading'), img.getAttribute('src')!).toBe('lazy')
    }
    expect(container.querySelectorAll('#lnd-shot img')).toHaveLength(SCREENS.length)
  })
})
