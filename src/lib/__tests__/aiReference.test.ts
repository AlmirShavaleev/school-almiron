import { describe, expect, it } from 'vitest'
import {
  ENGINE_ORDER,
  FREE_ENGINE,
  MAX_FAILURE_REASON_CHARS,
  MAX_REFERENCE_BYTES,
  OCR_ENGINE,
  REFERENCE_CHAR_LIMIT,
  REFERENCE_GAP_MARK,
  REFERENCE_TAIL_CHARS,
  describeParseFailure,
  extractAnnotationText,
  isParseUsable,
  meaningfulChars,
  nextEngine,
  referencePromptBlock,
  tooLittleTextReason,
  truncateReference,
} from '../../../supabase/functions/check-homework-ai/reference.ts'

/**
 * §135. Эталон авторского решения для ИИ-проверки.
 *
 * Модуль чистый именно ради этих тестов: сам `index.ts` живёт в Deno и в
 * песочнице не запускается, а решения «годен ли разбор» и «каким движком идти»
 * проверять надо — молча принятый мусор в кэше сделает проверку хуже, чем её
 * нынешнее отсутствие эталона.
 */

describe('порядок движков', () => {
  it('бесплатный первым, платный вторым, третьего нет', () => {
    expect(ENGINE_ORDER).toEqual([FREE_ENGINE, OCR_ENGINE])
    expect(nextEngine(null)).toBe(FREE_ENGINE)
    expect(nextEngine(FREE_ENGINE)).toBe(OCR_ENGINE)
    expect(nextEngine(OCR_ENGINE)).toBeNull()
  })

  it('движки названы точно так, как их зовёт поставщик', () => {
    // Умолчание у OpenRouter — ПЛАТНЫЙ mistral-ocr, поэтому имена важны:
    // опечатка в бесплатном движке молча уведёт на платный.
    expect(FREE_ENGINE).toBe('cloudflare-ai')
    expect(OCR_ENGINE).toBe('mistral-ocr')
  })
})

describe('meaningfulChars — считаем буквы и цифры, а не длину', () => {
  it('разметка и пробелы не считаются текстом', () => {
    expect(meaningfulChars('# | --- |\n\n|   |\n')).toBe(0)
    expect(meaningfulChars('Ответ: 42 м/с')).toBe(9)
  })
})

describe('isParseUsable — «пусто или мусор» числом', () => {
  const good = 'Решение задачи 1. '.repeat(20)

  it('нормальный разбор годен', () => {
    expect(isParseUsable(good, 1)).toBe(true)
  })

  it('пустая каша из разметки не годится', () => {
    expect(isParseUsable('#\n\n| | |\n---\n'.repeat(30), 3)).toBe(false)
  })

  it('одна распознанная страница из десяти — провал, хотя символов много', () => {
    // Именно этот случай опаснее всего: суммарно текста хватает, а девять
    // страниц решения потеряны.
    expect(isParseUsable(good, 1)).toBe(true)
    expect(isParseUsable(good, 10)).toBe(false)
  })

  it('совсем короткий текст не годится ни при каком числе страниц', () => {
    expect(isParseUsable('Ответ: 42', 1)).toBe(false)
  })
})

describe('extractAnnotationText — дословный текст из аннотаций', () => {
  const annotation = (parts: string[]) => ({
    type: 'file',
    file: { hash: 'h1', name: 'solution.pdf', content: parts.map(text => ({ type: 'text', text })) },
  })

  it('берёт содержимое из ответа модели', () => {
    const parsed = extractAnnotationText({
      choices: [{ message: { annotations: [annotation(['Стр 1', 'Стр 2'])] } }],
    })
    expect(parsed.text).toBe('Стр 1\n\nСтр 2')
    expect(parsed.pages).toBe(2)
  })

  it('берёт содержимое и из ветки ОШИБКИ инференса', () => {
    // Разбор уже оплачен: провал модели не должен стоить нам текста.
    const parsed = extractAnnotationText({
      error: { message: 'model failed', metadata: { file_annotations: [annotation(['Стр 1'])] } },
    })
    expect(parsed.text).toBe('Стр 1')
    expect(parsed.pages).toBe(1)
  })

  it('пустой или чужой ответ даёт пустой текст, а не падение', () => {
    expect(extractAnnotationText(null).text).toBe('')
    expect(extractAnnotationText({ choices: [{ message: { content: 'пересказ' } }] }).text).toBe('')
  })

  it('пересказ модели в текст не попадает', () => {
    // Эталон обязан быть дословным: пересказ сокращает и «поправляет» формулы.
    const parsed = extractAnnotationText({
      choices: [{
        message: {
          content: 'Кратко: решение про кинематику',
          annotations: [annotation(['v = v0 + at'])],
        },
      }],
    })
    expect(parsed.text).toBe('v = v0 + at')
  })
})

describe('truncateReference — режем середину, голову и хвост бережём (§149)', () => {
  it('короткое решение не трогает', () => {
    expect(truncateReference('Решение')).toEqual({ text: 'Решение', truncated: false })
  })

  it('длинное режет посередине: начало и конец на месте, между ними пометка', () => {
    const head = 'НАЧАЛО '.repeat(3000)
    const tail = ' ТАБЛИЦА ОТВЕТОВ 19 10'
    const long = head + 'середина '.repeat(4000) + tail
    const block = truncateReference(long)
    expect(block.truncated).toBe(true)
    expect(block.text.length).toBeLessThanOrEqual(REFERENCE_CHAR_LIMIT)
    expect(block.text.startsWith('НАЧАЛО НАЧАЛО')).toBe(true)
    expect(block.text.endsWith('ТАБЛИЦА ОТВЕТОВ 19 10')).toBe(true)
    expect(block.text).toContain(REFERENCE_GAP_MARK.trim())
  })

  it('хвост — ровно REFERENCE_TAIL_CHARS символов конца документа', () => {
    const long = 'x'.repeat(REFERENCE_CHAR_LIMIT) + 'y'.repeat(REFERENCE_TAIL_CHARS)
    const block = truncateReference(long)
    const afterGap = block.text.slice(block.text.indexOf(REFERENCE_GAP_MARK.trim()) + REFERENCE_GAP_MARK.trim().length)
    expect(afterGap.replace(/\s/g, '')).toBe('y'.repeat(REFERENCE_TAIL_CHARS))
  })

  it('на эталоне «Первой части» (16 867 символов) при лимите 14 000 таблица ответов не терялась бы', () => {
    // Воспроизведение прогона 11.09: при старой обрезке с хвоста задачи 17–19 и
    // таблица ответов на последней странице уходили за лимит.
    const doc = 'Задача 1 …'.padEnd(16_000, ' решение ') + '\n### Page 22\n1 -2\n2 -2,5\n… 19 10\nЗадача Ответ'
    const block = truncateReference(doc, 14_000)
    expect(block.truncated).toBe(true)
    expect(block.text).toContain('19 10')
    expect(block.text).toContain('Задача Ответ')
  })

  it('лимит 40 000 — решение владельца 12.09; 14 000 резало решение в 933 кБ', () => {
    expect(REFERENCE_CHAR_LIMIT).toBe(40_000)
    expect(REFERENCE_TAIL_CHARS).toBe(3_000)
  })
})

describe('referencePromptBlock — оговорка о происхождении обязательна', () => {
  it('говорит, что текст распознан и запись формул могла пострадать', () => {
    const block = referencePromptBlock({ text: 'v = v0 + at', truncated: false })
    expect(block).toContain('распознаванием PDF')
    expect(block).toContain('ЗАПИСИ формулы ошибкой ученика не считай')
    expect(block).not.toContain('НЕ ЦЕЛИКОМ')
  })

  it('при обрезке предупреждает, что продолжения не видно', () => {
    const block = referencePromptBlock({ text: 'v = v0 + at', truncated: true })
    expect(block).toContain('НЕ ЦЕЛИКОМ')
    expect(block).toContain('не считай ошибкой ученика')
  })
})

describe('порог размера', () => {
  it('десять мегабайт', () => {
    expect(MAX_REFERENCE_BYTES).toBe(10 * 1024 * 1024)
  })
})

/**
 * §149. Причины отказа — по ВСЕМ движкам, а не по последнему. Пять прогонов
 * подряд в last_error лежал только отказ платного mistral-ocr по балансу, и
 * что случилось с бесплатным cloudflare-ai, который шёл первым, узнать было
 * неоткуда.
 */
describe('describeParseFailure — причины всех движков в одной строке', () => {
  it('склеивает причины в порядке движков, первую не теряет', () => {
    const line = describeParseFailure([
      `движок ${FREE_ENGINE} вернул слишком мало текста (12 знач. симв. на 3 стр.)`,
      `движок ${OCR_ENGINE}: This request requires at least $0.50 in balance for files`,
    ])
    expect(line.startsWith('Не удалось распознать авторское решение: ')).toBe(true)
    expect(line.indexOf(FREE_ENGINE)).toBeGreaterThan(-1)
    expect(line.indexOf(FREE_ENGINE)).toBeLessThan(line.indexOf(OCR_ENGINE))
    expect(line).toContain('; ')
  })

  it('без причин говорит, что разбор не дал текста', () => {
    expect(describeParseFailure([])).toContain('разбор PDF не дал текста')
    expect(describeParseFailure(['', '  '])).toContain('разбор PDF не дал текста')
  })

  it('режет строку по потолку — её читает преподаватель в панели', () => {
    const long = describeParseFailure(['x'.repeat(400), 'y'.repeat(400)])
    expect(long.length).toBeLessThanOrEqual(MAX_FAILURE_REASON_CHARS)
    expect(long.endsWith('…')).toBe(true)
    expect(MAX_FAILURE_REASON_CHARS).toBe(500)
  })
})

describe('tooLittleTextReason — «мало» с числом, а не на словах', () => {
  it('называет движок, значимые символы и страницы', () => {
    const reason = tooLittleTextReason(FREE_ENGINE, '# | |\nabc 12', 3)
    expect(reason).toContain(FREE_ENGINE)
    expect(reason).toContain('5 знач. симв.')
    expect(reason).toContain('3 стр.')
  })

  it('ноль страниц считает за одну — деления на ноль в причине нет', () => {
    expect(tooLittleTextReason(OCR_ENGINE, '', 0)).toContain('0 знач. симв. на 1 стр.')
  })
})
