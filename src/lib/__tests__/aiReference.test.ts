import { describe, expect, it } from 'vitest'
import {
  ENGINE_ORDER,
  FREE_ENGINE,
  MAX_REFERENCE_BYTES,
  OCR_ENGINE,
  REFERENCE_CHAR_LIMIT,
  extractAnnotationText,
  isParseUsable,
  meaningfulChars,
  nextEngine,
  referencePromptBlock,
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

describe('truncateReference — режем хвост, начало бережём', () => {
  it('короткое решение не трогает', () => {
    expect(truncateReference('Решение')).toEqual({ text: 'Решение', truncated: false })
  })

  it('длинное режет и сообщает об этом', () => {
    const long = 'а'.repeat(REFERENCE_CHAR_LIMIT + 500)
    const block = truncateReference(long)
    expect(block.truncated).toBe(true)
    expect(block.text.length).toBeLessThanOrEqual(REFERENCE_CHAR_LIMIT)
    expect(long.startsWith(block.text)).toBe(true)
  })

  it('лимит поднят с прежних 8000', () => {
    expect(REFERENCE_CHAR_LIMIT).toBeGreaterThan(8000)
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
