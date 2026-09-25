// Probe: for given scene names, list the deepest elements that stick out past the viewport (390).
import { chromium } from '@playwright/test'
import path from 'node:path'
import { BASE, makeSession, makeHandler, newPage } from './lib.mjs'
import { personas, baseFixtures } from './fixtures.mjs'
import { scenes } from './scenes.mjs'

const names = process.argv.slice(2)
const assetsDir = path.resolve('screenshots/harness/assets')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
for (const s of scenes.filter(x => names.includes(x.name) && !x.width)) {
  const p = personas[s.persona]
  const session = p.user ? makeSession(p.user) : null
  const { context, page } = await newPage(browser, { session, staffProfileId: p.staffProfileId, staffMode: 'admin' })
  await context.route(u => !u.href.startsWith(BASE), makeHandler({ fixtures: baseFixtures(s.persona), session, assetsDir, log: () => {} }))
  await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 30000 })
  for (const a of s.actions ?? []) {
    try {
      if (a.click) await page.getByText(a.click, { exact: a.exact ?? false }).first().click({ timeout: 4000 })
      if (a.clickRole) await page.getByRole(a.clickRole[0], { name: a.clickRole[1] }).first().click({ timeout: 4000 })
      if (a.wait) await page.waitForTimeout(a.wait)
      if (a.ls) await page.evaluate(([k, v]) => localStorage.setItem(k, v), a.ls)
      if (a.goto) await page.goto(BASE + a.goto, { waitUntil: 'networkidle', timeout: 30000 })
    } catch {}
  }
  await page.waitForTimeout(800)
  const res = await page.evaluate(() => {
    const cw = document.documentElement.clientWidth
    const out = []
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el)
      if (cs.position === 'fixed') continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      const sticksOut = r.right > cw + 2
      const scrollsInside = el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(cs.overflowX)
      if (!sticksOut && !scrollsInside) continue
      // only deepest: skip if any child also sticks out
      const childOut = [...el.children].some(c => { const cr = c.getBoundingClientRect(); return cr.right > cw + 2 && cr.width > 0 })
      if (sticksOut && childOut) continue
      const path = []
      let e = el
      for (let i = 0; i < 4 && e && e !== document.body; i++) { path.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 4).join('.') : '')); e = e.parentElement }
      out.push(`${sticksOut ? 'OUT' : 'SCROLL'} right=${Math.round(r.right)} w=${Math.round(r.width)} sw=${el.scrollWidth} :: ${path.join(' > ')} :: "${(el.textContent || '').trim().slice(0, 50)}"`)
      if (out.length > 12) break
    }
    return { cw, sw: document.documentElement.scrollWidth, out }
  })
  console.log(`\n== ${s.name} (${s.url}) docScrollWidth=${res.sw} clientWidth=${res.cw}`)
  for (const l of res.out) console.log('  ' + l)
  await context.close()
}
await browser.close()
