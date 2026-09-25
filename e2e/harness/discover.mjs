// Discovery pass: every route with near-empty fixtures; logs which tables/RPCs each screen asks for.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { BASE, makeSession, makeHandler, newPage, ensureDir } from './lib.mjs'
import { personas, baseFixtures } from './fixtures.mjs'

const outDir = ensureDir(path.resolve('screenshots/harness/discover'))
const assetsDir = path.resolve('screenshots/harness/assets')
const logPath = path.resolve('screenshots/harness/discover.log')
fs.writeFileSync(logPath, '')

const routes = {
  student: ['/login', '/register', '/forgot-password', '/student', '/my-course', '/my-course/g1', '/my-course/g1/topic/t1',
    '/my-homework', '/catalog', '/student/variants', '/student/variants/generate', '/student/variants/build',
    '/student/variants/stats', '/my-progress', '/notifications', '/settings'],
  owner: ['/dashboard', '/teacher', '/admin', '/admin/telegram', '/course-program', '/catalog', '/cart', '/collections/c1',
    '/homework-queue', '/variants', '/variants/all', '/tests', '/students', '/students/st-1', '/notifications', '/settings',
    '/variant-builder', '/students/st-1/journal'],
}

const only = process.argv[2] // optional persona filter
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
for (const [name, persona] of Object.entries(personas)) {
  if (only && only !== name) continue
  const session = persona.user ? makeSession(persona.user) : null
  const { context, page } = await newPage(browser, { session, staffProfileId: persona.staffProfileId, staffMode: 'admin' })
  let current = ''
  const lines = []
  const handler = makeHandler({ fixtures: baseFixtures(name), session, assetsDir, log: (l) => lines.push(`  ${l}`) })
  await context.route(u => !u.href.startsWith(BASE), handler)
  page.on('console', m => { if (m.type() === 'error') lines.push(`  CONSOLE ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => lines.push(`  PAGEERROR ${String(e).slice(0, 200)}`))
  for (const r of routes[name]) {
    current = r
    lines.length = 0
    try {
      await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1200)
    } catch (e) { lines.push(`  NAV-ERR ${String(e).slice(0, 120)}`) }
    const finalUrl = page.url().replace(BASE, '')
    const shot = path.join(outDir, `${name}${r.replace(/\//g, '_')}.png`)
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    fs.appendFileSync(logPath, `\n== ${name} ${r} -> ${finalUrl}\n${lines.join('\n')}\n`)
    console.log(`${name} ${r} -> ${finalUrl} (${lines.length} lines)`)
  }
  await context.close()
}
await browser.close()
