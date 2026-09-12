import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Иллюстрации каталога на телефоне занимают всю ширину карточки (§154):
 * 50 % / 35 % от 358 px нечитаемы. Правило живёт в глобальном CSS, поэтому
 * проверяем сам CSS: медиа-блок для узких экранов существует и покрывает
 * оба класса иллюстраций, включая математический вариант с 35 %.
 */
describe('catalog figures on phones (index.css)', () => {
  const css = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')

  function mobileBlock(): string {
    const start = css.indexOf('@media (max-width: 639px)')
    expect(start).toBeGreaterThan(-1)
    const open = css.indexOf('{', start)
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      if (css[i] === '}') { depth--; if (depth === 0) return css.slice(start, i + 1) }
    }
    throw new Error('unbalanced media block')
  }

  it('на узком экране иллюстрации условия и решения — во всю ширину', () => {
    const block = mobileBlock()
    expect(block).toMatch(/img\.catalog-condition-figure/)
    expect(block).toMatch(/img\.catalog-solution-image/)
    expect(block).toMatch(/max-width:\s*100%\s*!important/)
  })

  it('математический вариант (35 %) тоже переопределён', () => {
    const block = mobileBlock()
    expect(block).toMatch(/scale-figures-math-exam img\.catalog-condition-figure/)
  })

  it('десктопные доли 50 % и 35 % не тронуты', () => {
    expect(css).toMatch(/max-width: 50% !important/)
    expect(css).toMatch(/max-width: 35% !important/)
  })
})
