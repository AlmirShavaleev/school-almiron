import { describe, it, expect } from 'vitest'
import {
  totalMaxPoints,
  sortItems,
  hasTextAnswer,
  formatScore,
  scorePercent,
} from './topicTest'

describe('topicTest helpers', () => {
  describe('totalMaxPoints', () => {
    it('суммирует баллы', () => {
      const items = [
        { max_points: 2 },
        { max_points: 3 },
        { max_points: 5 },
      ]
      expect(totalMaxPoints(items)).toBe(10)
    })

    it('возвращает 0 для пустого массива', () => {
      expect(totalMaxPoints([])).toBe(0)
    })

    it('работает с нулевыми баллами', () => {
      const items = [
        { max_points: 0 },
        { max_points: 5 },
      ]
      expect(totalMaxPoints(items)).toBe(5)
    })
  })

  describe('sortItems', () => {
    it('сортирует по position', () => {
      const items = [
        { position: 3, id: 'c' },
        { position: 1, id: 'a' },
        { position: 2, id: 'b' },
      ]
      const sorted = sortItems(items)
      expect(sorted.map(i => i.position)).toEqual([1, 2, 3])
    })

    it('не мутирует исходный массив', () => {
      const items = [
        { position: 2 },
        { position: 1 },
      ]
      const original = items[0]
      sortItems(items)
      expect(items[0]).toBe(original)
    })

    it('работает с пустым массивом', () => {
      expect(sortItems([])).toEqual([])
    })
  })

  describe('hasTextAnswer', () => {
    it('возвращает false если hasAnswer = false', () => {
      expect(hasTextAnswer('<p>text</p>', false)).toBe(false)
    })

    it('возвращает false если answerHtml = null', () => {
      expect(hasTextAnswer(null, true)).toBe(false)
    })

    it('возвращает false для пустого HTML', () => {
      expect(hasTextAnswer('', true)).toBe(false)
    })

    it('возвращает false если только теги', () => {
      expect(hasTextAnswer('<img src="x.svg">', true)).toBe(false)
    })

    it('возвращает false если только пробелы и &nbsp;', () => {
      expect(hasTextAnswer('  &nbsp; &nbsp;  ', true)).toBe(false)
    })

    it('возвращает true если есть текст в теге', () => {
      expect(hasTextAnswer('<p>4</p>', true)).toBe(true)
    })

    it('возвращает true если есть текст между тегами', () => {
      expect(hasTextAnswer('<strong>ответ</strong>', true)).toBe(true)
    })

    it('возвращает true если текст с перемешанными пробелами и &nbsp;', () => {
      expect(hasTextAnswer('&nbsp; слово &nbsp;', true)).toBe(true)
    })

    it('игнорирует множество вложенных тегов', () => {
      expect(hasTextAnswer('<div><span><b>ответ</b></span></div>', true)).toBe(true)
    })
  })

  describe('formatScore', () => {
    it('форматирует оценку', () => {
      expect(formatScore(6, 7)).toBe('6 / 7')
    })

    it('возвращает дефис если total = null', () => {
      expect(formatScore(null, 7)).toBe('—')
    })

    it('возвращает дефис если max = null', () => {
      expect(formatScore(6, null)).toBe('—')
    })

    it('возвращает дефис если оба null', () => {
      expect(formatScore(null, null)).toBe('—')
    })

    it('работает с нулями', () => {
      expect(formatScore(0, 10)).toBe('0 / 10')
    })
  })

  describe('scorePercent', () => {
    it('вычисляет процент', () => {
      expect(scorePercent(5, 10)).toBe(50)
    })

    it('округляет', () => {
      expect(scorePercent(1, 3)).toBe(33)
    })

    it('возвращает null если total = null', () => {
      expect(scorePercent(null, 10)).toBe(null)
    })

    it('возвращает null если max = null', () => {
      expect(scorePercent(5, null)).toBe(null)
    })

    it('возвращает null если max = 0 (деление на ноль)', () => {
      expect(scorePercent(5, 0)).toBe(null)
    })

    it('возвращает 0 если total = 0', () => {
      expect(scorePercent(0, 10)).toBe(0)
    })

    it('возвращает 100 если полный балл', () => {
      expect(scorePercent(10, 10)).toBe(100)
    })
  })
})
