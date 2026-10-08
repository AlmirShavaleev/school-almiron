import { describe, expect, it } from 'vitest'
import {
  digitsOrderNote, examTaskLabel, formatAnswerDisplay, parseAnswerSpec, taskCodeLabel, toleranceLine, toleranceRange,
  withRealMinus,
} from '@/lib/catalogAnswerSpec'

/** §269. Показ ответа переписанного каталога: «−», допуск только персоналу, шапка задачи. */
describe('parseAnswerSpec', () => {
  it('разбирает три вида и отбрасывает чужое', () => {
    expect(parseAnswerSpec({ type: 'number', value: '-8', tol: 0 })).toEqual({ type: 'number', value: '-8', tol: 0 })
    expect(parseAnswerSpec({ type: 'number', value: '-0,6', tol: 0.1 })).toEqual({ type: 'number', value: '-0.6', tol: 0.1 })
    expect(parseAnswerSpec({ type: 'digits', text: '145', any_order: true })).toEqual({ type: 'digits', text: '145', any_order: true })
    expect(parseAnswerSpec({ type: 'digits', text: '4,40,2' })).toEqual({ type: 'digits', text: '4,40,2', any_order: false })
    expect(parseAnswerSpec({ type: 'text', text: ' к наблюдателю ' })).toEqual({ type: 'text', text: 'к наблюдателю' })
    expect(parseAnswerSpec(null)).toBeNull()
    expect(parseAnswerSpec({ type: 'number', value: 'x' })).toBeNull()
    expect(parseAnswerSpec({ type: 'digits', text: '1a' })).toBeNull()
  })
})

describe('показ ответа', () => {
  it('число — запятая и настоящий минус', () => {
    expect(formatAnswerDisplay({ type: 'number', value: '-0.06', tol: 0 })).toBe('−0,06')
    expect(formatAnswerDisplay({ type: 'number', value: '12', tol: 0 })).toBe('12')
    expect(formatAnswerDisplay({ type: 'digits', text: '235' })).toBe('235')
  })
  it('допуск: «засчитываем от X до Y» без хвостов float и с «−»', () => {
    expect(toleranceLine({ type: 'number', value: '-8', tol: 0.1 })).toBe('засчитываем от −8,1 до −7,9')
    expect(toleranceLine({ type: 'number', value: '0.3', tol: 0.1 })).toBe('засчитываем от 0,2 до 0,4')
    expect(toleranceLine({ type: 'number', value: '0.05', tol: 0.1 })).toBe('засчитываем от −0,05 до 0,15')
    expect(toleranceLine({ type: 'number', value: '-4', tol: 1 })).toBe('засчитываем от −5 до −3')
    expect(toleranceRange({ type: 'number', value: '2.5', tol: 0.01 })).toEqual({ from: '2,49', to: '2,51' })
    expect(toleranceLine({ type: 'number', value: '1', tol: 1 })).toBe('засчитываем от 0 до 2')
    expect(toleranceLine({ type: 'number', value: '-8', tol: 0 })).toBeNull()
    expect(toleranceLine({ type: 'digits', text: '12' })).toBeNull()
    expect(toleranceLine(null)).toBeNull()
  })
  it('цифры в любом порядке — пометка персоналу', () => {
    expect(digitsOrderNote({ type: 'digits', text: '14', any_order: true })).toBe('цифры в любом порядке')
    expect(digitsOrderNote({ type: 'digits', text: '14', any_order: false })).toBeNull()
  })
  it('withRealMinus — только простая строка-число', () => {
    expect(withRealMinus('-1,6')).toBe('−1,6')
    expect(withRealMinus('−1,6')).toBe('−1,6')
    expect(withRealMinus('<p>-1</p>')).toBe('<p>-1</p>')
    expect(withRealMinus('12')).toBe('12')
    expect(withRealMinus(null)).toBeNull()
  })
})

describe('шапка задачи', () => {
  it('код задачи; у скрытой старой строки — прежний номер', () => {
    expect(taskCodeLabel(96090)).toBe('#96090')
    expect(taskCodeLabel(1000096090)).toBe('#96090')
    expect(taskCodeLabel(2000096090)).toBe('#96090')
    expect(taskCodeLabel(0)).toBeNull()
  })
  it('«Задание N ЕГЭ» вместо «КИМ N»', () => {
    expect(examTaskLabel(7, 'ЕГЭ')).toBe('Задание 7 ЕГЭ')
    expect(examTaskLabel(null, 'ЕГЭ')).toBeNull()
  })
})
