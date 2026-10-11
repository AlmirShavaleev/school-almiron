import { expect, test, type Page } from '@playwright/test'
import path from 'path'

/**
 * Лендинг глазами гостя (ЛЕНДИНГ_ТЗ.md §5): страница открывается и на `/`, и
 * на `/about`, CTA ведут на `/register`, на телефонах нет горизонтального
 * скролла. Запуск: `npx playwright test -c playwright.landing.config.ts`.
 */

const TITLE = 'Готовься к экзамену по авторскому курсу в своём темпе'

async function openLanding(page: Page, url = '/') {
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(TITLE)
}

test('гость на `/` видит лендинг, адрес не меняется', async ({ page }) => {
  await openLanding(page, '/')
  await page.waitForTimeout(500)
  expect(new URL(page.url()).pathname).toBe('/')
})

test('`/about` тоже открывает лендинг', async ({ page }) => {
  await openLanding(page, '/about')
})

test('все CTA регистрации ведут на /register', async ({ page }) => {
  await openLanding(page)
  for (const name of ['Регистрация', 'Начать бесплатно →', 'Создать аккаунт →', 'Зарегистрироваться', 'Начать с 3 бесплатных дней']) {
    const links = page.getByRole('link', { name, exact: true })
    expect(await links.count(), name).toBeGreaterThan(0)
    for (const href of await links.evaluateAll(els => els.map(e => e.getAttribute('href')))) expect(href, name).toBe('/register')
  }
  await expect(page.getByRole('link', { name: 'Войти', exact: true })).toHaveAttribute('href', '/login')
})

test('клик «Регистрация» в шапке открывает форму регистрации', async ({ page }) => {
  await openLanding(page)
  await page.getByRole('link', { name: 'Регистрация', exact: true }).click()
  await expect(page).toHaveURL(/\/register$/)
})

test('клик «Создать аккаунт» в финальном блоке открывает регистрацию', async ({ page }) => {
  await openLanding(page)
  await page.getByRole('link', { name: 'Создать аккаунт →' }).click()
  await expect(page).toHaveURL(/\/register$/)
})

for (const width of [360, 390, 430]) {
  test(`ширина ${width}px — без горизонтального скролла, плавающая кнопка видна`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openLanding(page)
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)) }
    })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('link', { name: 'Начать бесплатно', exact: true })).toBeVisible()
  })
}

const SHOTS = process.env.LANDING_SHOTS_DIR

for (const scheme of ['light', 'dark'] as const) {
  for (const [label, width, height] of [['desktop-1280', 1280, 900], ['mobile-390', 390, 844]] as const) {
    test(`скриншот ${label} ${scheme}`, async ({ page }) => {
      test.skip(!SHOTS, 'LANDING_SHOTS_DIR не задан')
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.setViewportSize({ width, height })
      await openLanding(page)
      await page.evaluate(() => document.fonts.ready)
      // Иконки ниже первого экрана — loading="lazy": без прокрутки полный
      // снимок вышел бы с пустыми местами. Проходим страницу и ждём картинки.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 400) {
          window.scrollTo(0, y)
          await new Promise(r => setTimeout(r, 40))
        }
        await Promise.all([...document.images].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r })))
        window.scrollTo(0, 0)
      })
      await page.screenshot({ path: path.join(SHOTS!, `лендинг-${label}-${scheme}.png`), fullPage: true })
      await page.screenshot({ path: path.join(SHOTS!, `лендинг-${label}-${scheme}-первый-экран.png`) })
    })
  }
}
