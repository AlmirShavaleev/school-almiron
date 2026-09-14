// Generates placeholder images/PDF for the harness (no real photos, no real names).
import { chromium } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

const out = path.resolve('screenshots/harness/assets')
fs.mkdirSync(out, { recursive: true })

const pages = {
  'photo.png': { w: 1200, h: 1600, html: `
    <div style="width:1200px;height:1600px;background:#f4efe6;font-family:'Segoe Script','Comic Sans MS',cursive;padding:80px;box-sizing:border-box;color:#2b2b6b;font-size:44px;line-height:1.6">
      <div style="opacity:.8">Дано: m = 2 кг, v₀ = 3 м/с, α = 30°</div>
      <div>Найти: t, S</div>
      <div style="margin-top:40px">Решение:</div>
      <div>1) Ox: max = −mg·sinα − μ·N</div>
      <div>2) N = mg·cosα ⇒ a = −g(sinα + μ·cosα)</div>
      <div>3) a = −9,8·(0,5 + 0,2·0,87) ≈ −6,6 м/с²</div>
      <div>4) t = v₀ / |a| = 3 / 6,6 ≈ 0,45 с</div>
      <div>5) S = v₀² / (2|a|) = 9 / 13,2 ≈ 0,68 м</div>
      <div style="margin-top:60px">Ответ: t ≈ 0,45 с; S ≈ 0,68 м</div>
      <div style="margin-top:200px;opacity:.25;font-size:30px">линия сгиба · тетрадь в клетку</div>
    </div>` },
  'table.png': { w: 700, h: 220, html: `
    <table style="border-collapse:collapse;font-family:Arial;font-size:22px;background:#fff">
      <tr><th style="border:1px solid #333;padding:6px 14px">t, с</th><td style="border:1px solid #333;padding:6px 14px">0</td><td style="border:1px solid #333;padding:6px 14px">1</td><td style="border:1px solid #333;padding:6px 14px">2</td><td style="border:1px solid #333;padding:6px 14px">3</td><td style="border:1px solid #333;padding:6px 14px">4</td><td style="border:1px solid #333;padding:6px 14px">5</td><td style="border:1px solid #333;padding:6px 14px">6</td></tr>
      <tr><th style="border:1px solid #333;padding:6px 14px">x, м</th><td style="border:1px solid #333;padding:6px 14px">0</td><td style="border:1px solid #333;padding:6px 14px">2</td><td style="border:1px solid #333;padding:6px 14px">8</td><td style="border:1px solid #333;padding:6px 14px">18</td><td style="border:1px solid #333;padding:6px 14px">32</td><td style="border:1px solid #333;padding:6px 14px">50</td><td style="border:1px solid #333;padding:6px 14px">72</td></tr>
      <tr><th style="border:1px solid #333;padding:6px 14px">v, м/с</th><td style="border:1px solid #333;padding:6px 14px">0</td><td style="border:1px solid #333;padding:6px 14px">4</td><td style="border:1px solid #333;padding:6px 14px">8</td><td style="border:1px solid #333;padding:6px 14px">12</td><td style="border:1px solid #333;padding:6px 14px">16</td><td style="border:1px solid #333;padding:6px 14px">20</td><td style="border:1px solid #333;padding:6px 14px">24</td></tr>
    </table>` },
  'formula.png': { w: 900, h: 120, html: `
    <div style="font-family:'Times New Roman';font-size:40px;background:#fff;padding:20px;white-space:nowrap">
      F = G·m₁·m₂ / r² ,  E = mc² ,  ∫₀^∞ e^(−x²) dx = √π / 2 ,  x = (−b ± √(b² − 4ac)) / 2a
    </div>` },
  'figure.png': { w: 600, h: 400, html: `
    <svg width="600" height="400" xmlns="http://www.w3.org/2000/svg" style="background:#fff">
      <line x1="60" y1="340" x2="560" y2="340" stroke="#222" stroke-width="3"/>
      <line x1="60" y1="340" x2="60" y2="40" stroke="#222" stroke-width="3"/>
      <polyline points="60,340 160,220 260,260 360,120 460,160 560,60" fill="none" stroke="#c0392b" stroke-width="4"/>
      <text x="520" y="370" font-size="26" font-family="Arial">t, с</text>
      <text x="20" y="60" font-size="26" font-family="Arial">v</text>
    </svg>` },
}

// §173: «сырой» снимок для сцены s04-topic4-upload-dng. Содержимое неважно —
// гейт судит по типу/расширению, а до декодера файл не доходит.
fs.writeFileSync(path.join(out, 'raw.dng'), Buffer.from('not-a-real-dng'))

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [name, { w, h, html }] of Object.entries(pages)) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<body style="margin:0">${html}</body>`)
  await page.screenshot({ path: path.join(out, name) })
}
await page.setContent(`<body style="font-family:Georgia;padding:40px"><h1>Материал темы</h1><p>Кинематика равноускоренного движения. Основные формулы: v = v₀ + at, S = v₀t + at²/2.</p><p>Таблица значений и три задачи для самостоятельного решения.</p></body>`)
await page.pdf({ path: path.join(out, 'doc.pdf'), format: 'A4' })
await browser.close()
console.log('assets:', fs.readdirSync(out).join(' '))
