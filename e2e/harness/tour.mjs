// Tour: walks screens for each persona at 390 (and 360), saves viewport + full-page shots, logs requests.
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { BASE, makeSession, makeHandler, newPage, ensureDir } from './lib.mjs'
import { personas, baseFixtures, IDS } from './fixtures.mjs'
import { scenes } from './scenes.mjs'

const outDir = ensureDir(path.resolve('screenshots/harness/tour'))
const assetsDir = path.resolve('screenshots/harness/assets')
const logPath = path.resolve('screenshots/harness/tour.log')
fs.writeFileSync(logPath, '')

const filter = process.argv[2] // substring of scene name, optional
/*
 * §211. Необязательный второй фильтр — ширина. Нужен там, где сцена ПИШЕТ в
 * базу: фикстуры — это обычные экспортируемые массивы, один на процесс, и
 * запись из сцены на 1280 видна сцене с тем же именем на 390. Для «до/после»
 * это смертельно: «до» на второй ширине приезжает уже «после». Прогон каждой
 * ширины своим процессом разводит их по разным наборам фикстур:
 *   node e2e/harness/tour.mjs o06-rotate 1280
 *   node e2e/harness/tour.mjs o06-rotate 390
 */
const widthFilter = process.argv[3] ? Number(process.argv[3]) : null
const browser = await chromium.launch()
const contexts = {}
async function ctxFor(persona, width, height) {
  const key = `${persona}:${width}x${height}`
  if (contexts[key]) return contexts[key]
  const p = personas[persona]
  const session = p.user ? makeSession(p.user) : null
  const { context, page } = await newPage(browser, { session, staffProfileId: p.staffProfileId, staffMode: p.staffMode ?? 'admin', mobilePreview: p.mobilePreview ?? false, width, height })
  const lines = []
  const handler = makeHandler({ fixtures: baseFixtures(persona), session, assetsDir, log: (l) => lines.push(`  ${l}`) })
  await context.route(u => !u.href.startsWith(BASE), handler)
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/ERR_FAILED|net::|Download the React DevTools|fonts/.test(m.text())) lines.push(`  CONSOLE ${m.text().slice(0, 220)}`) })
  page.on('pageerror', e => lines.push(`  PAGEERROR ${String(e).slice(0, 220)}`))
  page.on('dialog', d => d.dismiss().catch(() => {}))
  contexts[key] = { context, page, lines }
  return contexts[key]
}

for (const s of scenes) {
  if (filter && !s.name.includes(filter)) continue
  const width = s.width ?? 390, height = s.height ?? 844
  if (widthFilter && width !== widthFilter) continue
  const { page, lines } = await ctxFor(s.persona, width, height)
  lines.length = 0
  /*
   * §217. Печатный вид. Лист для родителя живёт в портале `document.body` и
   * показывается только правилами `@media print` — без переключения носителя
   * снимок печати неотличим от снимка экрана. Контексты общие на персону и
   * ширину, поэтому носитель ставится КАЖДОЙ сцене, а не только печатной:
   * иначе печатная сцена оставила бы `print` следующей за ней.
   */
  await page.emulateMedia({ media: s.media ?? 'screen' }).catch(() => {})
  try {
    if (s.url) await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 30000 })
    for (const a of s.actions ?? []) {
      try {
        if (a.click) await page.getByText(a.click, { exact: a.exact ?? false }).first().click({ timeout: 4000 })
        if (a.clickRole) await page.getByRole(a.clickRole[0], { name: a.clickRole[1] }).first().click({ timeout: 4000 })
        if (a.clickSel) await page.locator(a.clickSel).first().click({ timeout: 4000 })
        // §181: действия ВНУТРИ «телефона» (iframe мобильного вида). Перехват
        // запросов стоит на контексте, так что вложенное окно обслуживается
        // теми же фикстурами без дополнительной настройки.
        if (a.frameClick) await page.frameLocator('iframe[title="Мобильный вид"]').getByText(a.frameClick, { exact: a.exact ?? false }).first().click({ timeout: 4000 })
        if (a.frameClickSel) await page.frameLocator('iframe[title="Мобильный вид"]').locator(a.frameClickSel).first().click({ timeout: 4000 })
        if (a.frameEval) await page.frames().find(f => f.name() === 'mobile-preview')?.evaluate(a.frameEval)
        if (a.fill) await page.locator(a.fill[0]).first().fill(a.fill[1], { timeout: 4000 })
        if (a.focus) await page.locator(a.focus).first().focus({ timeout: 4000 })
        // §209. Обвести область на работе: рамку под замечание рисуют мышью,
        // и снять «создание заметки» иначе нечем.
        if (a.drag) {
          const box = await page.locator(a.drag.sel).first().boundingBox({ timeout: 4000 })
          if (box) {
            const at = ([fx, fy]) => [box.x + box.width * fx, box.y + box.height * fy]
            const [x1, y1] = at(a.drag.from)
            const [x2, y2] = at(a.drag.to)
            await page.mouse.move(x1, y1)
            await page.mouse.down()
            await page.mouse.move(x2, y2, { steps: 8 })
            await page.mouse.up()
          }
        }
        if (a.scroll) await page.evaluate((y) => window.scrollTo(0, y), a.scroll)
        if (a.wait) await page.waitForTimeout(a.wait)
        if (a.eval) await page.evaluate(a.eval)
        if (a.ls) await page.evaluate(([k, v]) => localStorage.setItem(k, v), a.ls)
        if (a.files) await page.locator('input[type=file]').last().setInputFiles(a.files.map(f => path.resolve(assetsDir, f)), { timeout: 4000 })
        if (a.chooseFiles) { const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), page.locator(a.chooseFiles.clickSel).first().click({ timeout: 4000 })]); await fc.setFiles(a.chooseFiles.files.map(f => path.resolve(assetsDir, f))) }
        if (a.goto) await page.goto(BASE + a.goto, { waitUntil: 'networkidle', timeout: 30000 })
      } catch (e) { lines.push(`  ACTION-FAIL ${JSON.stringify(a)} ${String(e).split('\n')[0].slice(0, 160)}`) }
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(s.settle ?? 600)
  } catch (e) { lines.push(`  NAV-ERR ${String(e).slice(0, 160)}`) }
  const finalUrl = page.url().replace(BASE, '')
  const base = path.join(outDir, `${s.name}${width !== 390 ? '-' + width : ''}`)
  await page.screenshot({ path: base + '.png' }).catch(() => {})
  if (s.full !== false) await page.screenshot({ path: base + '-full.png', fullPage: true }).catch(() => {})
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.scrollWidth, cw = document.documentElement.clientWidth
    const wide = []
    if (w > cw) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.right > cw + 1 && r.width > 0 && el.children.length < 30) { wide.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}→${Math.round(r.right)}`); if (wide.length > 5) break }
      }
    }
    return { w, cw, wide }
  }).catch(() => null)
  const ovLine = overflow && overflow.w > overflow.cw ? `  OVERFLOW scrollWidth=${overflow.w} > ${overflow.cw}: ${overflow.wide.join(' | ')}` : ''
  fs.appendFileSync(logPath, `\n== ${s.name} [${s.persona} ${width}] ${s.url ?? ''} -> ${finalUrl}\n${ovLine}\n${lines.join('\n')}\n`)
  console.log(`${s.name} -> ${finalUrl}${ovLine ? '  ⚠ overflow' : ''}`)
}
await browser.close()
