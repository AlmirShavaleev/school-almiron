import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
// Флаг подписки (выкатка в main, 16.10): цены и «3 дня бесплатно» — только при включённой подписке.
const flag = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/hooks/useSubscription', () => ({ useSubscriptionsEnabled: () => ({ enabled: flag.enabled, loading: false }) }))
beforeEach(() => { flag.enabled = true })

import { LandingPage } from '@/pages/LandingPage'
import { initialUnlock, LESSONS, submitHomework } from '../unlockLogic'
import { ICONS, PHOTO, SCENES, SCREENS } from '../icons'

/**
 * Smoke-тест лендинга, правка 4 (письмо лендинг_v3_6_аргументов.md, эталон —
 * лендинг_прототип_v3.html): блоки в порядке прототипа, CTA ведут туда, куда
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
  it('блоки в порядке прототипа v3', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toBe('Дай мне 6 аргументов — и ты поймёшь, почему эта платформа тебе подходит')
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
      'Учёба, к которой хочется возвращаться',
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
    expect(hrefOf('Слушаю →')).toEqual(['#cozy'])
    expect(hrefOf('6 аргументов')).toEqual(['#cozy'])
    expect(hrefOf('Сразу к цене')).toEqual(['#price'])
    expect(hrefOf('Узнать цену →')).toEqual(['#price', '#price', '#price'])
    for (const id of ['cozy', 'a2', 'a3', 'a4', 'a5', 'a6', 'inside', 'price', 'faq', 'final']) {
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

  it('«6 аргументов» везде, «5 аргументов» и строки «Твой план» больше нет', () => {
    const { container } = renderLanding()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/5 аргументов/)
    expect(text).not.toMatch(/Твой план/)
    expect(screen.getByText('Это были 6 аргументов. Ну что, убедил?')).toBeTruthy()
    expect(screen.getByText(/Разреши за 6 аргументов/)).toBeTruthy()
    expect(['Аргумент первый', 'Аргумент второй', 'Аргумент третий', 'Аргумент четвёртый', 'Аргумент пятый', 'Аргумент шестой']
      .every(t => screen.getByText(t))).toBe(true)
  })

  it('листок с решением: ответ без единиц, соседняя карточка это ловит', () => {
    const { container } = renderLanding()
    const paper = container.querySelector('.paper')!
    expect(paper.querySelectorAll('.hl')).toHaveLength(6)
    expect(paper.querySelector('.ans')?.textContent).toBe('Ответ: 2')
    expect(screen.getByText('Нет единиц в ответе')).toBeTruthy()
  })

  it('цена: три карточки и «дешевле в 6 и 14 раз»', () => {
    const { container } = renderLanding()
    expect([...container.querySelectorAll('.pt .pt-l')].map(e => e.textContent)).toEqual(['Репетитор', 'Онлайн-школа', 'Платформа Almiron'])
    expect(container.querySelector('.psave')?.textContent).toBe('Almiron дешевле онлайн-школы в 6 раз, а репетитора — в 14 раз и больше')
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
    const files = [...ICONS.map(n => `/brand/icons/${n}.webp`), PHOTO.avatar.src, SCENES.sunset.src, SCENES.desk.src, ...SCREENS.map(s => s.src)]
    expect(files.filter(f => !existsSync(pub(f)))).toEqual([])
  })

  it('на первом экране нет 3D-иконок; закат — сразу и с высоким приоритетом', () => {
    const { container } = renderLanding()
    const hero = container.querySelector('#top')!
    expect(hero.querySelector('img[src^="/brand/icons/"]')).toBeNull()
    const photo = hero.querySelector(`img[src="${SCENES.sunset.src}"]`)!
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
    for (const img of imgs.filter(i => /\/brand\/(icons|screens)\/|desk\.webp/.test(i.getAttribute('src')!))) {
      expect(img.getAttribute('loading'), img.getAttribute('src')!).toBe('lazy')
    }
    expect(container.querySelectorAll('#lnd-shot img')).toHaveLength(SCREENS.length)
  })
})

describe('лендинг без подписки (гость; подписка не запущена)', () => {
  it('нет цен, «3 дня бесплатно», диагностики и вопроса про подписку; регистрация на месте', () => {
    flag.enabled = false
    renderLanding()
    expect(document.querySelector('[data-testid="price"]')).toBeNull()
    expect(screen.queryByText(/3 дня бесплатно|3 бесплатных дней|без карты/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Пройти диагностику' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Как отменить подписку/ })).toBeNull()
    expect(screen.queryByText(/₽/)).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Регистрация' }).every(a => a.getAttribute('href') === '/register')).toBe(true)
  })
})
