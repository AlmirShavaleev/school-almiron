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
  // §202: мелкий скан — в каталоге такие есть (в печати они раньше оставались
  // размером с ноготь рядом с чертежом на пол-страницы). Ширина 150 px выбрана
  // как типичный «мелкий исходник» (<200 px, см. §17).
  'figure-small.png': { w: 150, h: 110, html: `
    <svg width="150" height="110" xmlns="http://www.w3.org/2000/svg" style="background:#fff">
      <line x1="18" y1="92" x2="142" y2="92" stroke="#222" stroke-width="1"/>
      <line x1="18" y1="92" x2="18" y2="10" stroke="#222" stroke-width="1"/>
      <polyline points="18,92 48,60 78,70 108,28 142,16" fill="none" stroke="#c0392b" stroke-width="2"/>
      <text x="120" y="106" font-size="9" font-family="Arial">t, с</text>
      <text x="4" y="18" font-size="9" font-family="Arial">x</text>
    </svg>` },
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

/*
 * §205 (board/056). Формулы каталога — это SVG из внешнего конвейера, а не
 * растр. В печати их размер на бумаге определяется НАТУРАЛЬНЫМ размером файла,
 * поэтому заглушка обязана повторять именно его. Числа ниже сняты с настоящего
 * экспорта владельца (подборка по математике, 14 страниц, A4 книжная, поля
 * 12 мм, кегль текста 8 pt): у каждой формулы на странице PDF есть свой clip —
 * это и есть её бокс, из него делится обратно натуральный размер
 * (`px = pt / 0,75 / zoom`).
 *
 * Оказалось, что конвейер отдаёт формулы в РАЗНОМ разрешении:
 *
 *   семейство       натур. размер, px     высота цифры, px
 *   обычное         100…470 × 30…350      ~16
 *   «гигант»        516…640 × 645…1835    ~47…58
 *
 * Отсюда четыре случая, которые нужны на печатном листе, плюс пятый —
 * короткая система в «гигантском» разрешении (её ни один потолок по высоте
 * до конца не чинит, и это видно только на ней).
 */
const FS = 'Times New Roman, Times, serif'
// Кегль подбирается по высоте цифры: у Times capHeight ≈ 0,662 em.
const svgFormulas = {
  // p. 3 экспорта: вся цепочка из шести систем — ОДНА картинка 640×1835.
  // 12 строк по 153 px, цифра 52,7 px.
  'formula-sys-long.svg': sysSvg(640, 1835, 12, 153, 80, 100),
  // p. 1 экспорта: та же «гигантская» плотность, но всего 4 строки — 516×645.
  'formula-sys-short.svg': sysSvg(516, 645, 4, 161, 87, 110),
  // p. 5 экспорта: короткое равенство в обычном разрешении, 120×55.
  'formula-eq.svg': sysSvg(120, 55, 2, 27, 21, 20),
  // Строчная формула с дробью и корнем: 146×49 (высота втрое больше строчной
  // простой — из-за неё жёсткая `height: 1.05em` и давала ноготок).
  'formula-frac.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="146" height="49" viewBox="0 0 146 49">
  <text x="0" y="34" font-family="${FS}" font-size="24">&#8730;15x = 1</text>
  <text x="104" y="20" font-family="${FS}" font-size="24">2</text>
  <line x1="100" y1="26" x2="124" y2="26" stroke="#000" stroke-width="2"/>
  <text x="104" y="46" font-family="${FS}" font-size="24">3</text>
</svg>`,
  // Простая строчная формула в одну строку: 186×25.
  'formula-inline.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="186" height="25" viewBox="0 0 186 25">
  <text x="0" y="19" font-family="${FS}" font-size="24">2</text>
  <text x="14" y="9" font-family="${FS}" font-size="15">&#8722;4&#8722;x</text>
  <text x="62" y="19" font-family="${FS}" font-size="24">= 16 &#8722; 4x</text>
</svg>`,
}
// Система уравнений: фигурная скобка на пару строк + сами строки.
function sysSvg(w, h, rows, step, fontSize, firstBaseline) {
  const lines = []
  for (let i = 0; i < rows; i++) {
    const y = firstBaseline + i * step
    if (i % 2 === 0) {
      lines.push(`<text x="${w * 0.04}" y="${y + step * 0.62}" font-family="${FS}" font-size="${fontSize * 1.9}">{</text>`)
    }
    lines.push(`<text x="${w * 0.16}" y="${y}" font-family="${FS}" font-size="${fontSize}">${i % 2 === 0 ? '15x = 25x' : 'x &#8805; 0'}</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${lines.join('\n')}\n</svg>`
}
for (const [name, body] of Object.entries(svgFormulas)) fs.writeFileSync(path.join(out, name), body)

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
