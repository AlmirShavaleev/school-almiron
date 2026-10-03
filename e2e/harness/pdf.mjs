// §261. Печать страницы харнесса в PDF (Chromium, A4, как «Печать → Сохранить как PDF») и число листов.
//   HARNESS_PORT=5261 CHROMIUM_PATH=… node e2e/harness/pdf.mjs <persona> <url> <out.pdf> [eval-перед-печатью]
// Печатает то же, что браузер: носитель print, поля по умолчанию. Число листов — по объектам /Type /Page в PDF.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { BASE, makeSession, makeHandler, newPage } from './lib.mjs'
import { personas, baseFixtures } from './fixtures.mjs'

const [persona, url, out, before] = process.argv.slice(2)
if (!persona || !url || !out) {
  console.error('usage: node e2e/harness/pdf.mjs <persona> <url> <out.pdf> [eval]')
  process.exit(2)
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const p = personas[persona]
const session = p.user ? makeSession(p.user) : null
const { context, page } = await newPage(browser, { session, staffProfileId: p.staffProfileId, staffMode: p.staffMode ?? 'admin', width: 1280, height: 900 })
await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: baseFixtures(persona), session, assetsDir: path.resolve('screenshots/harness/assets'), log: () => {} }))
await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 })
await page.waitForTimeout(1200)
if (before) { await page.evaluate(before); await page.waitForTimeout(1500) }
await page.emulateMedia({ media: 'print' })
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
await page.pdf({ path: out, format: 'A4', printBackground: false })
await browser.close()
const pages = (fs.readFileSync(out, 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
console.log(`${out}: ${pages} ${pages === 1 ? 'лист' : pages < 5 ? 'листа' : 'листов'}`)
