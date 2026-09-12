import { describe, it, expect } from 'vitest'
import { middleEllipsis } from '../fileName'

describe('middleEllipsis', () => {
  it('короткое имя не трогает', () => {
    expect(middleEllipsis('photo.jpg')).toBe('photo.jpg')
    expect(middleEllipsis('', 10)).toBe('')
  })

  it('имя ровно в лимит не трогает', () => {
    const name = 'a'.repeat(24) + '.jpg'
    expect(middleEllipsis(name, 28)).toBe(name)
  })

  it('длинное имя режет посередине, расширение и хвост остаются', () => {
    const name = 'IMG_20260911_очень_длинное_имя_файла_с_телефона_1.jpg'
    const out = middleEllipsis(name, 28)
    expect(out.length).toBeLessThanOrEqual(28)
    expect(out).toContain('…')
    expect(out.endsWith('_1.jpg')).toBe(true)
    expect(out.startsWith('IMG_2026')).toBe(true)
  })

  it('без расширения тоже режет посередине', () => {
    const name = 'x'.repeat(60)
    const out = middleEllipsis(name, 20)
    expect(out.length).toBeLessThanOrEqual(20)
    expect(out).toContain('…')
  })

  it('слишком маленький лимит не ломает строку', () => {
    const out = middleEllipsis('abcdefghijklmnop.pdf', 2)
    expect(out).toContain('…')
    expect(out.length).toBeLessThanOrEqual(5)
  })
})
