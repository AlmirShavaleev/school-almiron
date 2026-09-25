import { describe, it, expect } from 'vitest'
import {
  formatEgeNumbers,
  parseEgeNumbersFromTitle,
  parseEgeNumbersInput,
} from '@/lib/egeTaskNumbers'

/**
 * §216. Случаи здесь — те же, что покрывает SQL-функция
 * `public.ege_numbers_from_title(text)` из PENDING_216.sql. Правило: список
 * случаев у близнецов один, иначе заполнение базы и экран разойдутся, и
 * заметит это родитель в распечатанном отчёте.
 */
describe('разбор номеров из названия темы', () => {
  it('берёт один номер', () => {
    expect(parseEgeNumbersFromTitle('№13 — Методы решения тригонометрических уравнений')).toEqual([13])
  })

  it('берёт список через запятую без пробелов', () => {
    expect(parseEgeNumbersFromTitle('№1,17 Планиметрия и стереометрия')).toEqual([1, 17])
    expect(parseEgeNumbersFromTitle('№6,7')).toEqual([6, 7])
  })

  it('берёт список через запятую с пробелами', () => {
    expect(parseEgeNumbersFromTitle('МЕГАДЗ — №13, 14, 15 Оптика')).toEqual([13, 14, 15])
  })

  it('разворачивает диапазон', () => {
    expect(parseEgeNumbersFromTitle('№22-23 Механика')).toEqual([22, 23])
    expect(parseEgeNumbersFromTitle('№1-12 из ЕГЭ по математике')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('понимает латинское Nº и N° наравне с №', () => {
    expect(parseEgeNumbersFromTitle('Nº21 Неравенства')).toEqual([21])
    expect(parseEgeNumbersFromTitle('nº21 Неравенства')).toEqual([21])
    expect(parseEgeNumbersFromTitle('N°21 Неравенства')).toEqual([21])
  })

  it('не трогает названия без номера', () => {
    expect(parseEgeNumbersFromTitle('Электродинамика: повторение')).toEqual([])
    expect(parseEgeNumbersFromTitle('Задание 13 без знака номера')).toEqual([])
    expect(parseEgeNumbersFromTitle('')).toEqual([])
    expect(parseEgeNumbersFromTitle(null)).toEqual([])
  })

  it('тире с пробелами — это не диапазон, а отбивка названия', () => {
    expect(parseEgeNumbersFromTitle('№1 — 2 часа теории')).toEqual([1])
  })

  it('год после дефиса не считает вторым концом диапазона', () => {
    expect(parseEgeNumbersFromTitle('№1-2026 год')).toEqual([1])
  })

  it('собирает номера из нескольких знаков номера и убирает повторы', () => {
    expect(parseEgeNumbersFromTitle('Выпуск №16 Обзор неравенства №15 с ЕГЭ 2023')).toEqual([15, 16])
    expect(parseEgeNumbersFromTitle('№13, 13, 14 Повтор')).toEqual([13, 14])
  })

  it('отбрасывает числа вне 1..40', () => {
    expect(parseEgeNumbersFromTitle('№99 Бессмыслица')).toEqual([])
  })
})

describe('разбор поля «номера заданий ЕГЭ»', () => {
  it('пустая строка — это «номера не заданы», а не ошибка', () => {
    expect(parseEgeNumbersInput('')).toEqual({ numbers: [], error: null })
    expect(parseEgeNumbersInput('   ')).toEqual({ numbers: [], error: null })
  })

  it('берёт список через запятую', () => {
    expect(parseEgeNumbersInput('13, 14, 15')).toEqual({ numbers: [13, 14, 15], error: null })
    expect(parseEgeNumbersInput('1,17')).toEqual({ numbers: [1, 17], error: null })
  })

  it('разворачивает диапазон и сортирует с устранением повторов', () => {
    expect(parseEgeNumbersInput('22-23')).toEqual({ numbers: [22, 23], error: null })
    expect(parseEgeNumbersInput('15, 13, 14, 13')).toEqual({ numbers: [13, 14, 15], error: null })
  })

  it('прощает знак номера и пробелы вместо запятых', () => {
    expect(parseEgeNumbersInput('№13 №14')).toEqual({ numbers: [13, 14], error: null })
    expect(parseEgeNumbersInput('Nº6 7')).toEqual({ numbers: [6, 7], error: null })
  })

  it('объясняет словами, что не так', () => {
    expect(parseEgeNumbersInput('оптика').error).toBe('«оптика» — не номер задания')
    expect(parseEgeNumbersInput('0').error).toBe('Номер должен быть от 1 до 40')
    expect(parseEgeNumbersInput('41').error).toBe('Номер должен быть от 1 до 40')
    expect(parseEgeNumbersInput('23-22').error).toBe('Диапазон «23-22» задом наперёд')
  })

  it('при ошибке не отдаёт половину списка', () => {
    expect(parseEgeNumbersInput('13, оптика, 15').numbers).toEqual([])
  })
})

describe('показ номеров', () => {
  it('склеивает через запятую', () => {
    expect(formatEgeNumbers([13, 14, 15])).toBe('13, 14, 15')
  })

  it('пусто — пустая строка, а не «0» и не прочерк', () => {
    expect(formatEgeNumbers([])).toBe('')
    expect(formatEgeNumbers(null)).toBe('')
    expect(formatEgeNumbers(undefined)).toBe('')
  })

  it('пережёвывает несортированное и повторы', () => {
    expect(formatEgeNumbers([15, 13, 14, 13])).toBe('13, 14, 15')
  })
})
