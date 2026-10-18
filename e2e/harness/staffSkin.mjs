/**
 * Кабинет учителя и админа в стиле нового ЛК (письмо ЛК_учитель_и_админ_редизайн.md, 17.10):
 * владелец в режимах «Администратор» и «Учитель» — колонка-меню, «Ещё», шапка,
 * нижняя панель на телефоне; 1280 и 390, светлая и тёмная.
 *
 *   HARNESS_PORT=5231 node e2e/harness/staffSkin.mjs <папка>
 *   MODES=admin,teacher  WIDTHS=1280,390  ONLY=admin,more (фильтр по имени сцены)
 */
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler, ensureDir } from './lib.mjs'
import { personas, baseFixtures } from './fixtures.mjs'

const outDir = ensureDir(path.resolve(process.argv[2] || 'screenshots/harness/staff-skin'))
const assetsDir = path.resolve('screenshots/harness/assets')
const MODES = (process.env.MODES || 'admin,teacher').split(',')
const WIDTHS = (process.env.WIDTHS || '1280,390').split(',').map(Number)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null

const SHOTS = [
  { name: 'главная', url: '/dashboard' },
  { name: 'админ', url: '/admin', modes: ['admin'] },
  { name: 'проверка', url: '/homework-queue' },
  { name: 'курсы', url: '/course-program' },
  { name: 'ещё', url: '/dashboard', more: true, lightOnly: true },
  { name: 'помощь', url: '/dashboard', help: true, lightOnly: true },
  { name: 'обращения', url: '/admin/support', modes: ['admin'] },
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const p = personas.owner
const session = makeSession(p.user)

for (const mode of MODES) {
  for (const width of WIDTHS) {
    for (const theme of ['light', 'dark']) {
      const mobile = width < 768
      const context = await browser.newContext({
        viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile, hasTouch: mobile, locale: 'ru-RU', timezoneId: 'Europe/Moscow',
      })
      await context.addInitScript(({ session, staffProfileId, mode, theme }) => {
        try {
          localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
          localStorage.setItem('almiron:staff-mode:' + staffProfileId, mode)
          sessionStorage.setItem('almiron:staff-mode-chosen:' + staffProfileId, '1')
          localStorage.setItem('almiron:student-theme', theme)
        } catch {}
      }, { session, staffProfileId: p.staffProfileId, mode, theme })
      await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: baseFixtures('owner'), session, assetsDir, log: () => {} }))
      const page = await context.newPage()
      for (const s of SHOTS) {
        if (s.modes && !s.modes.includes(mode)) continue
        if (s.lightOnly && theme !== 'light') continue
        if (ONLY && !ONLY.includes(s.name)) continue
        await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 30000 })
        await page.waitForTimeout(1500)
        if (s.more) { await page.click(mobile ? '[data-testid="staff-tab-more"]' : '[data-testid="staff-nav-more"]'); await page.waitForTimeout(400) }
        if (s.help) { await page.click('[data-testid="support-widget-button"]').catch(() => {}); await page.waitForTimeout(500) }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        const file = path.join(outDir, `персонал-${mode}-${s.name}-${width}-${theme}.png`)
        await page.screenshot({ path: file, fullPage: !s.more && !s.help })
        console.log(`${file}${overflow > 0 ? `  ⚠ горизонтальный скролл ${overflow}px` : ''}`)
      }
      await context.close()
    }
  }
}
await browser.close()
