import { describe, it, expect } from 'vitest'
import { shouldBoostPrintFigures } from '@/utils/variantPrintUtils'

describe('shouldBoostPrintFigures', () => {
  it('физика ЕГЭ по-русски (как в каталоге) — укрупняем', () => {
    expect(shouldBoostPrintFigures({ subject: 'Физика', exam_type: 'ЕГЭ' })).toBe(true)
  })

  it('слаги physics/ege (как в courses) — укрупняем', () => {
    expect(shouldBoostPrintFigures({ subject: 'physics', exam_type: 'ege' })).toBe(true)
  })

  it('физика ОГЭ — пока нет (владелец просил начать с ЕГЭ)', () => {
    expect(shouldBoostPrintFigures({ subject: 'Физика', exam_type: 'ОГЭ' })).toBe(false)
  })

  it('математика ЕГЭ — нет', () => {
    expect(shouldBoostPrintFigures({ subject: 'Математика', exam_type: 'ЕГЭ' })).toBe(false)
  })

  it('нет задачи или полей — нет и падения', () => {
    expect(shouldBoostPrintFigures(null)).toBe(false)
    expect(shouldBoostPrintFigures(undefined)).toBe(false)
    expect(shouldBoostPrintFigures({ subject: null as unknown as string, exam_type: null as unknown as string })).toBe(false)
  })
})
