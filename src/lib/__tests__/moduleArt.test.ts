import { describe, expect, it } from 'vitest'
import { moduleArtKey, moduleCardTitle, moduleIsPractice, moduleTag } from '../moduleArt'

describe('§281: карточка раздела — рисунок и пометка', () => {
  it('рисунок по названию раздела', () => {
    expect(moduleArtKey('Математическая база')).toBe('math')
    expect(moduleArtKey('Кинематика')).toBe('kinematics')
    expect(moduleArtKey('Динамика')).toBe('dynamics')
    expect(moduleArtKey('Законы сохранения')).toBe('conservation')
    expect(moduleArtKey('Задачи формата ЕГЭ. Механика')).toBe('ege')
    expect(moduleArtKey('Механика: мини-уроки ЕГЭ (пилот)')).toBe('ege')
    expect(moduleArtKey('Колебания и волны')).toBe('oscillations')
    expect(moduleArtKey('Что-то новое')).toBe('orbit')
  })

  it('вместо служебного номера 100/101 — пометка словами', () => {
    expect(moduleTag('Кинематика', 1)).toBe('Раздел 1')
    expect(moduleTag('Математическая база', 0)).toBe('Раздел 0')
    expect(moduleTag('Задачи формата ЕГЭ. Механика', 100)).toBe('Практика ЕГЭ')
    expect(moduleTag('Механика: мини-уроки ЕГЭ (пилот)', 101)).toBe('Пилот')
  })

  it('практика и пилот — отдельным тоном; «(пилот)» из заголовка уходит в пометку', () => {
    expect(moduleIsPractice('Кинематика', 1)).toBe(false)
    expect(moduleIsPractice('Задачи формата ЕГЭ. Механика', 100)).toBe(true)
    expect(moduleCardTitle('Механика: мини-уроки ЕГЭ (пилот)')).toBe('Механика: мини-уроки ЕГЭ')
    expect(moduleCardTitle('Кинематика')).toBe('Кинематика')
  })
})
