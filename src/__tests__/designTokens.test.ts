import { beforeAll, describe, expect, it } from 'vitest'

/**
 * §225. Контраст токенов дизайн-системы v2.
 *
 * Палитры `primary`, `gold`, `graphite` и стандартные `gray`/`slate`
 * перенастроены в `tailwind.config.js` — по сайту это тысячи классов, и
 * ошибка в одной ступени молча делает нечитаемым текст на сотне экранов.
 * Проверяем пары, которые реально встречаются: текст на белой карточке и на
 * самом светлом месте фона (#e6efff — там контраст ниже всего), белый текст
 * на кнопке действия, тёмный текст на жёлтом акценте, текст меню на обоих
 * концах его градиента, текст меток состояния на своей заливке.
 *
 * Порог — 4.5:1 (WCAG AA для обычного текста); для значков и контуров
 * значимых элементов — 3:1.
 */

type Scale = Record<string, string>
interface Palette {
  primary: Scale
  gold: Scale
  graphite: Scale
  gray: Scale
  slate: Scale
  menu: Scale
  action: Scale
  canvas: Scale
  verdict: Record<string, Scale>
}

let c: Palette

beforeAll(async () => {
  // Путь переменной: конфиг — обычный JS без типов, tsc его не проверяет.
  const path = '../../tailwind.config.js'
  const config = (await import(/* @vite-ignore */ path)).default
  c = config.theme.extend.colors as Palette
})

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = '#ffffff'

describe('токены v2: контраст текста', () => {
  it('нейтральные ступени 500–950 читаются на карточке и на фоне', () => {
    for (const scale of [c.graphite, c.gray, c.slate]) {
      for (const step of ['500', '600', '700', '800', '900', '950']) {
        expect(contrast(scale[step], WHITE), `ink-${step} на белом`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(scale[step], c.canvas.top), `ink-${step} на фоне`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(scale[step], c.canvas.mid), `ink-${step} на кремовом`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('основной и вторичный текст — значения макета', () => {
    expect(c.graphite['900']).toBe('#12234a')
    expect(c.graphite['500']).toBe('#55607a')
    expect(c.graphite['300']).toBe('#c9d6ef')
  })

  it('400 (подсказки, значки) не светлее 3:1 на белом', () => {
    expect(contrast(c.gray['400'], WHITE)).toBeGreaterThanOrEqual(3)
  })

  it('ссылки и текст действия (primary 500–950) читаются на белом и на primary-50', () => {
    for (const step of ['500', '600', '700', '800', '900', '950']) {
      expect(contrast(c.primary[step], WHITE), `primary-${step}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.primary[step], c.primary['50']), `primary-${step} на 50`).toBeGreaterThanOrEqual(4.3)
    }
    for (const step of ['600', '700', '800']) {
      expect(contrast(c.primary[step], c.canvas.top), `primary-${step} на фоне`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('белый текст на кнопке действия — по всей длине градиента', () => {
    expect(contrast(WHITE, c.action.from)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(WHITE, c.action.to)).toBeGreaterThanOrEqual(4.5)
    for (const step of ['500', '600', '700']) {
      expect(contrast(WHITE, c.primary[step]), `белый на primary-${step}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('на жёлтом акценте — только тёмный текст; белый на нём нечитаем', () => {
    for (const step of ['200', '300', '400']) {
      expect(contrast(c.graphite['900'], c.gold[step]), `ink-900 на gold-${step}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(c.gold['300']).toBe('#ffc933')
    expect(contrast(WHITE, c.gold['300'])).toBeLessThan(3)
  })

  it('тёмный текст на светлых заливках gold (метки «внимание»)', () => {
    for (const step of ['700', '800', '900']) {
      expect(contrast(c.gold[step], c.gold['50'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.gold[step], c.gold['100'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('меню: светлый текст на обоих концах градиента', () => {
    for (const bg of [c.menu.top, c.menu.bottom]) {
      expect(contrast(c.menu.text, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.menu.muted, bg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(WHITE, bg)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('метки состояния: текст на своей заливке ≥ 4.5, значок на белом ≥ 3', () => {
    for (const [name, v] of Object.entries(c.verdict)) {
      expect(contrast(v.ink, v.tint), `${name}: текст на заливке`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(v.ink, WHITE), `${name}: текст на белом`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(v.DEFAULT, WHITE), `${name}: значок на белом`).toBeGreaterThanOrEqual(3)
    }
  })
})
