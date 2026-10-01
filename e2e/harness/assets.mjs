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
  // §252: проверочная «Производная» (вариант 1, ответы из ключа — как в
  // макете), 16 строк. Строки стоят ровно: строка n — сверху 200 + (n − 1)·78 px,
  // по этим долям в фикстурах лежат находки ИИ и рамки (`line252`).
  'photo-derivative.png': { w: 1200, h: 1600, html: `
    <div style="width:1200px;height:1600px;position:relative;background:#fbfaf6;background-image:linear-gradient(#dfe6ef 1px,transparent 1px),linear-gradient(90deg,#dfe6ef 1px,transparent 1px);background-size:39px 39px;font-family:'Segoe Script','Comic Sans MS',cursive;color:#243c8f">
      <div style="position:absolute;left:80px;top:90px;font-size:44px">Проверочная работа · Вариант 1</div>
      ${['15x⁴ − 4/(3∛x²)', '−3/x⁴ − 1/√x', '3/2·√x − 5/x²', '1/(2cos²x) + sin x/3', '1/2 + 1/sin²x', '7', '13', '7x⁶ − 4x³ − 2', '(5x² − 3)/(2√x) + 2x', 'cos 2x', '2x·tg x + x²/cos²x', '4x/(x² − 1)²', '(x − 1)/(2√x(x + 1)²)', '−2/(x − 1)²', '6x − 1', '3cos 3x']
        .map((a, i) => `<div style="position:absolute;left:84px;top:${200 + i * 78}px;height:64px;line-height:64px;font-size:42px;white-space:nowrap">${i + 1}) y′ = ${a}</div>`).join('')}
    </div>` },
  // §211 (board/062): та же тетрадь, но СНЯТАЯ БОКОМ — ученик держал телефон
  // поперёк. Именно такие страницы и разворачивает кнопка поворота. Наклон
  // против часовой выбран не случайно: кнопка крутит ПО часовой, и такая
  // страница выправляется одним нажатием — как оно и бывает чаще всего.
  'photo-sideways.png': { w: 1600, h: 1200, html: `
    <div style="width:1600px;height:1200px;background:#f4efe6;position:relative;overflow:hidden">
      <div style="position:absolute;left:50%;top:50%;width:1200px;height:1600px;transform:translate(-50%,-50%) rotate(-90deg);font-family:'Segoe Script','Comic Sans MS',cursive;padding:80px;box-sizing:border-box;color:#2b2b6b;font-size:44px;line-height:1.6;background:#f4efe6">
        <div style="opacity:.8">Дано: m = 2 кг, v₀ = 3 м/с, α = 30°</div>
        <div>Найти: t, S</div>
        <div style="margin-top:40px">Решение:</div>
        <div>1) Ox: max = −mg·sinα − μ·N</div>
        <div>2) N = mg·cosα ⇒ a = −g(sinα + μ·cosα)</div>
        <div>3) a = −9,8·(0,5 + 0,2·0,87) ≈ −6,6 м/с²</div>
        <div>4) t = v₀ / |a| = 3 / 6,6 ≈ 0,45 с</div>
        <div>5) S = v₀² / (2|a|) = 9 / 13,2 ≈ 0,68 м</div>
        <div style="margin-top:60px">Ответ: t ≈ 0,45 с; S ≈ 0,68 м</div>
        <div style="margin-top:200px;opacity:.25;font-size:30px">снято боком · телефон поперёк</div>
      </div>
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const page = await browser.newPage()
for (const [name, { w, h, html }] of Object.entries(pages)) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<body style="margin:0">${html}</body>`)
  await page.screenshot({ path: path.join(out, name) })
}
await page.setContent(`<body style="font-family:Georgia;padding:40px"><h1>Материал темы</h1><p>Кинематика равноускоренного движения. Основные формулы: v = v₀ + at, S = v₀t + at²/2.</p><p>Таблица значений и три задачи для самостоятельного решения.</p></body>`)
await page.pdf({ path: path.join(out, 'doc.pdf'), format: 'A4' })
// §229. Условие варианта (три страницы, как настоящий вариант ЕГЭ), скан второй
// части (две страницы «от руки») и критерии — всё выдумано.
const tasks = [
  'Найдите значение выражения (3,6 · 10⁻²) : (1,2 · 10⁻⁴).',
  'В треугольнике ABC угол C равен 90°, AC = 12, cos A = 0,6. Найдите AB.',
  'Найдите корень уравнения log₃(x + 4) = 2.',
  'В группе 20 учеников, из них 7 — отличники. Найдите вероятность, что случайно выбранный ученик — отличник.',
  'Найдите значение выражения 5 sin 17° / cos 73°.',
  'Прямая y = 5x − 8 касается графика функции y = x² + bx + 1. Найдите b, если абсцисса точки касания больше 0.',
  'Объём конуса равен 48. Через середину высоты проведена плоскость, параллельная основанию. Найдите объём отсечённого конуса.',
  'Материальная точка движется по закону x(t) = t³ − 3t² + 2t. Найдите скорость в момент t = 3 с.',
  'Первая труба наполняет бак за 12 минут, вторая — за 6. За сколько минут наполнят бак обе трубы?',
  'На рисунке — график функции f(x) = kx + b. Найдите f(−4).',
  'Найдите наибольшее значение функции y = 12x − x³ на отрезке [−1; 3].',
  'Решите уравнение 2cos²x + 3sin x − 3 = 0. Укажите корни на отрезке [π; 5π/2].',
]
const page1 = `<div style="page-break-after:always"><h2 style="margin:0 0 6px">Пробный ЕГЭ · математика, профиль</h2><h3 style="margin:0 0 18px;color:#555">Вариант 2</h3>${tasks.slice(0, 6).map((t, i) => `<p style="margin:0 0 20px"><b>${i + 1}.</b> ${t}</p><div style="border-bottom:1px solid #999;width:40%;margin:0 0 18px">Ответ: ________</div>`).join('')}</div>`
const page2 = `<div style="page-break-after:always">${tasks.slice(6).map((t, i) => `<p style="margin:0 0 20px"><b>${i + 7}.</b> ${t}</p><div style="border-bottom:1px solid #999;width:40%;margin:0 0 18px">Ответ: ________</div>`).join('')}</div>`
const page3 = `<div><h3>Часть 2</h3>${['13. а) Решите уравнение 2sin²x − √3 cos(π/2 − x) = 0. б) Найдите корни на [−3π; −3π/2].', '14. В правильной пирамиде SABCD все рёбра равны 6. Найдите угол между SA и плоскостью SBC.', '15. Решите неравенство log₂(x² − 4) − 3log₂((x + 2)/(x − 2)) > 2.', '16. В июле планируется взять кредит на сумму 1,3 млн рублей…', '17. Окружность касается сторон AB и BC треугольника ABC…', '18. Найдите все a, при которых система имеет ровно два решения.', '19. На доске написаны 30 натуральных чисел…'].map(t => `<p style="margin:0 0 16px">${t}</p>`).join('')}</div>`
await page.setContent(`<body style="font-family:Georgia;font-size:15px;padding:36px">${page1}${page2}${page3}</body>`)
await page.pdf({ path: path.join(out, 'variant.pdf'), format: 'A4' })
const hand = (lines) => `<div style="page-break-after:always;font-family:'Comic Sans MS',cursive;font-size:22px;color:#1c2f7a;line-height:2.1;background:repeating-linear-gradient(#fff 0 44px,#b9c9ee 44px 46px);min-height:1000px;padding:30px">${lines.map(l => `<div>${l}</div>`).join('')}</div>`
await page.setContent(`<body style="margin:0">${hand(['№13', 'а) 2sin²x − √3 sin x = 0', 'sin x (2 sin x − √3) = 0', 'sin x = 0 или sin x = √3/2', 'x = πk; x = π/3 + 2πk; x = 2π/3 + 2πk', 'б) −3π; −2π; −5π/3; −4π/3'])}${hand(['№15', 'ОДЗ: x² − 4 > 0, (x+2)/(x−2) > 0', 'log₂(x−2)(x+2) − 3log₂(x+2) + 3log₂(x−2) > 2', '4log₂(x−2) − 2log₂(x+2) > 2', 'Ответ: (2 + 2√2; +∞)'])}</body>`)
await page.pdf({ path: path.join(out, 'scan.pdf'), format: 'A4' })
await page.setContent(`<body style="font-family:Georgia;padding:40px"><h2>Критерии оценивания · вариант 2</h2><p><b>13.</b> 2 балла — обоснованно получены верные ответы в обоих пунктах; 1 балл — верно решён один пункт.</p><p><b>14.</b> 3 балла — обоснованно получен верный ответ; 2 балла — доказан пункт а) и получен неверный ответ в б) из-за вычислительной ошибки.</p></body>`)
await page.pdf({ path: path.join(out, 'criteria.pdf'), format: 'A4' })
await browser.close()
console.log('assets:', fs.readdirSync(out).join(' '))
