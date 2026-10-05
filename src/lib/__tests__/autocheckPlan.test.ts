import { describe, expect, it } from 'vitest'
import {
  contentTypeOf, importRows, missingFiles, parseTasksJson, storagePathFor, topicMatchesTitle,
// @ts-expect-error — скрипт на .mjs без типов, тестируем его чистые функции
} from '../../../scripts/autocheck-plan.mjs'

/**
 * §266. Загрузчик задач с автопроверкой: формат задачи.json (его готовит чат
 * курса) и строки для RPC topic_autocheck_import.
 */

const GOOD = {
  topic: '1.4.1',
  tasks: [
    { code: '1.4.1-Д-02', n: 2, statement: '02_условие.svg', solution: '02_решение.svg',
      answer: { type: 'number', value: 8, unit: 'мин' } },
    { code: '1.4.1-Д-01', n: 1, statement: '01_условие.svg', solution: '01_решение.svg',
      answer: { type: 'number', value: 100, tol: 0, unit: 'м' } },
    { code: '1.4.1-Д-03', n: 3, statement: '03_условие.svg', solution: '03_решение.svg',
      answer: { type: 'digits', text: '31', any_order: true } },
  ],
}

describe('parseTasksJson', () => {
  it('годный файл: задачи по n, умолчания tol = 0 и any_order = false', () => {
    const r = parseTasksJson(JSON.stringify(GOOD))
    expect(r.problems).toEqual([])
    expect(r.topic).toBe('1.4.1')
    expect(r.tasks.map((t: { n: number }) => t.n)).toEqual([1, 2, 3])
    expect(r.tasks[1]).toMatchObject({ code: '1.4.1-Д-02', answerType: 'number', value: 8, tol: 0, unit: 'мин' })
    expect(r.tasks[2]).toMatchObject({ answerType: 'digits', text: '31', anyOrder: true, unit: null })
  })

  it('не JSON и пустой список — проблема, а не падение', () => {
    expect(parseTasksJson('{').problems[0]).toMatch(/не JSON/)
    expect(parseTasksJson('{"tasks": []}').problems[0]).toMatch(/непустой массив/)
    expect(parseTasksJson('[]').problems[0]).toMatch(/ожидался объект/)
  })

  it('ловит повтор кода и номера, кривые ответы, не-картинки', () => {
    const bad = {
      topic: '1.4.1',
      tasks: [
        { code: 'A', n: 1, statement: 'a.svg', solution: 'a.pdf', answer: { type: 'number', value: '100' } },
        { code: 'A', n: 1, statement: 'b.svg', answer: { type: 'digits', text: '3a' } },
        { code: '', n: 0, statement: '', answer: { type: 'text' } },
        { code: 'D', n: 4, statement: 'd.svg', answer: { type: 'number', value: 1, tol: -1 } },
        { code: 'E', n: 5, statement: 'e.svg', answer: { type: 'digits', text: '12', any_order: 'да' } },
      ],
    }
    const r = parseTasksJson(JSON.stringify(bad))
    const all = r.problems.join('\n')
    expect(all).toMatch(/задача 1 \(A\): решение «a\.pdf» — не \.svg\/\.png/)
    expect(all).toMatch(/задача 1 \(A\): "answer\.value" — число/)
    expect(all).toMatch(/задача 2 \(A\): код повторяется/)
    expect(all).toMatch(/задача 2 \(A\): номер n = 1 повторяется/)
    expect(all).toMatch(/задача 2 \(A\): "answer\.text" — строка из цифр/)
    expect(all).toMatch(/задача 3: "code"/)
    expect(all).toMatch(/задача 3: "n" — целое/)
    expect(all).toMatch(/задача 3: нет "statement"/)
    expect(all).toMatch(/задача 3: "answer\.type"/)
    expect(all).toMatch(/задача 4 \(D\): "answer\.tol" — число ≥ 0/)
    expect(all).toMatch(/задача 5 \(E\): "answer\.any_order" — true или false/)
    // Без решения — предупреждение, не отказ.
    expect(r.warnings.join('\n')).toMatch(/задача 2 \(A\): нет "solution"/)
  })
})

describe('файлы и строки для базы', () => {
  it('missingFiles — без повторов', () => {
    const { tasks } = parseTasksJson(JSON.stringify(GOOD))
    const have = new Set(['01_условие.svg', '01_решение.svg', '02_условие.svg'])
    expect(missingFiles(tasks, (n: string) => have.has(n))).toEqual(['02_решение.svg', '03_условие.svg', '03_решение.svg'])
  })

  it('путь — по содержимому: тот же файл → тот же путь, ASCII; другой → другой', () => {
    const a = storagePathFor('topic-1', '01_условие.svg', Buffer.from('<svg>1</svg>'))
    expect(a).toMatch(/^topic-1\/[0-9a-f]{16}\.svg$/)
    expect(storagePathFor('topic-1', 'копия.svg', Buffer.from('<svg>1</svg>'))).toBe(a)
    expect(storagePathFor('topic-1', '01_условие.svg', Buffer.from('<svg>2</svg>'))).not.toBe(a)
    expect(storagePathFor('topic-1', 'x.PNG', Buffer.from('p'))).toMatch(/\.png$/)
    expect(contentTypeOf('x.svg')).toBe('image/svg+xml')
    expect(contentTypeOf('x.png')).toBe('image/png')
  })

  it('importRows — поля RPC topic_autocheck_import', () => {
    const { tasks } = parseTasksJson(JSON.stringify(GOOD))
    const rows = importRows(tasks, (name: string) => `T/${name}`)
    expect(rows[0]).toEqual({
      code: '1.4.1-Д-01', position: 1, statement_path: 'T/01_условие.svg', solution_path: 'T/01_решение.svg',
      answer_type: 'number', answer_value: 100, answer_tol: 0, answer_text: null, digits_any_order: false, unit: 'м',
    })
    expect(rows[2]).toMatchObject({ answer_type: 'digits', answer_value: null, answer_text: '31', digits_any_order: true })
  })

  it('topicMatchesTitle — номер подтемы в начале названия урока', () => {
    expect(topicMatchesTitle('1.4.1', '1.4.1 Скорость, путь и время')).toBe(true)
    expect(topicMatchesTitle('1.4.1', '1.4.10 Другое')).toBe(false)
    expect(topicMatchesTitle('1.4.1', 'Скорость')).toBe(false)
    expect(topicMatchesTitle(null, 'что угодно')).toBe(true)
  })
})
