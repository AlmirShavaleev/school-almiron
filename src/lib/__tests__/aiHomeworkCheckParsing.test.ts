import { describe, it, expect } from 'vitest'
// Разбор ответа модели живёт в Edge Function (Deno), но это чистые функции,
// и проверять их надо тем же прогоном, что и остальной код. Deno в песочнице
// нет, поэтому импортируем файл напрямую — он ни на что серверное не опирается.
import {
  boxToRect,
  extractJsonPayload,
  extractOpenAiPayload,
  fitScoreToScale,
  parseCheckResponse,
  parseJsonText,
} from '../../../supabase/functions/check-homework-ai/parse.ts'
import {
  providerLabel,
  resolveProvider,
} from '../../../supabase/functions/check-homework-ai/providers.ts'

/**
 * Здесь проверяется единственное место, где мы верим модели на слово.
 * Всё, что она вернёт кривого, обязано выпасть тихо и поштучно: результат —
 * черновик преподавателю, и одна битая рамка не должна отменить остальные.
 */

function response(payload: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }
}

const OK_FINDING = {
  file_index: 0,
  page: 1,
  box_2d: [100, 200, 300, 600], // ymin, xmin, ymax, xmax
  category: 'calc',
  text: 'Потерян знак минус',
}

describe('boxToRect — перевод рамки Gemini в формат annotation_sets', () => {
  it('переводит шкалу 0..1000 в нормализованную', () => {
    expect(boxToRect([100, 200, 300, 600])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 })
  })

  it('чинит перепутанный порядок координат', () => {
    // Модель иногда отдаёт max раньше min — рамка от этого не перестаёт быть
    // осмысленной, а вот отрицательная ширина сломала бы CHECK в базе.
    expect(boxToRect([300, 600, 100, 200])).toEqual({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 })
  })

  it('принимает рамку ровно по краю страницы', () => {
    expect(boxToRect([0, 0, 1000, 1000])).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('отбрасывает координаты не в той шкале', () => {
    // Похоже на пиксели, а не на 0..1000 — верить такому нельзя.
    expect(boxToRect([120, 340, 1800, 2400])).toBeNull()
  })

  it('отбрасывает вырожденную рамку', () => {
    expect(boxToRect([100, 200, 100, 600])).toBeNull()
    expect(boxToRect([100, 200, 102, 202])).toBeNull()
  })

  it('отбрасывает мусор вместо массива', () => {
    expect(boxToRect(null)).toBeNull()
    expect(boxToRect([1, 2, 3])).toBeNull()
    expect(boxToRect(['a', 'b', 'c', 'd'])).toBeNull()
    expect(boxToRect([NaN, 0, 100, 100])).toBeNull()
  })
})

describe('parseCheckResponse', () => {
  it('разбирает нормальный ответ', () => {
    const parsed = parseCheckResponse(
      { readable: true, summary: 'Решение верное', suggested_score: 5, confidence: 'high', findings: [OK_FINDING] },
      1,
    )
    expect(parsed.readable).toBe(true)
    expect(parsed.suggestedScore).toBe(5)
    expect(parsed.confidence).toBe('high')
    expect(parsed.findings).toHaveLength(1)
    expect(parsed.findings[0].category).toBe('calc')
  })

  it('снимает балл, если модель сама сказала, что не разобрала работу', () => {
    // Противоречие внутри ответа. Верим признанию в нечитаемости, а не баллу:
    // балл за то, чего не прочитал, — худший из двух вариантов.
    const parsed = parseCheckResponse(
      { readable: false, summary: 'Фото размыто', suggested_score: 4, confidence: 'low', findings: [] },
      1,
    )
    expect(parsed.readable).toBe(false)
    expect(parsed.suggestedScore).toBeNull()
  })

  it('выбрасывает находку с рамкой на несуществующий файл', () => {
    const parsed = parseCheckResponse(
      {
        readable: true, summary: 'ок', suggested_score: 3, confidence: 'medium',
        findings: [OK_FINDING, { ...OK_FINDING, file_index: 7 }],
      },
      1,
    )
    expect(parsed.findings).toHaveLength(1)
  })

  it('одна битая находка не уносит остальные', () => {
    const parsed = parseCheckResponse(
      {
        readable: true, summary: 'ок', suggested_score: 3, confidence: 'medium',
        findings: [
          OK_FINDING,
          { ...OK_FINDING, box_2d: 'ерунда' },
          { ...OK_FINDING, text: '   ' },
          null,
          { ...OK_FINDING, category: 'stroke', text: 'чужая категория' },
        ],
      },
      1,
    )
    // Остались нормальная и та, у которой только категория чужая — её
    // приводим к 'comment', терять текст замечания из-за ярлыка незачем.
    expect(parsed.findings).toHaveLength(2)
    expect(parsed.findings[1].category).toBe('comment')
  })

  it('неизвестную уверенность считает низкой', () => {
    const parsed = parseCheckResponse(
      { readable: true, summary: 'ок', suggested_score: null, confidence: 'абсолютная', findings: [] },
      1,
    )
    expect(parsed.confidence).toBe('low')
  })

  it('падает, только если разбирать нечего', () => {
    expect(() => parseCheckResponse(null, 1)).toThrow()
    expect(() => parseCheckResponse({ readable: true, summary: '  ', findings: [] }, 1)).toThrow()
  })
})

describe('fitScoreToScale', () => {
  it('пропускает балл в пределах шкалы', () => {
    expect(fitScoreToScale(4, 'five')).toBe(4)
    expect(fitScoreToScale(87, 'hundred')).toBe(87)
    expect(fitScoreToScale(0, 'five')).toBe(0)
  })

  it('отбрасывает балл не из той шкалы', () => {
    // Частая ошибка модели: «85» при пятибалльной шкале. В базе стоит CHECK,
    // и попытка записать такое уронила бы весь прогон вместе с текстом разбора.
    expect(fitScoreToScale(85, 'five')).toBeNull()
    expect(fitScoreToScale(-1, 'hundred')).toBeNull()
  })

  it('без шкалы балла не бывает', () => {
    expect(fitScoreToScale(4, null)).toBeNull()
  })
})

describe('extractJsonPayload', () => {
  it('достаёт JSON из обычного ответа', () => {
    expect(extractJsonPayload(response({ a: 1 }))).toEqual({ a: 1 })
  })

  it('переживает markdown-обёртку', () => {
    const wrapped = { candidates: [{ content: { parts: [{ text: '```json\n{"a":1}\n```' }] } }] }
    expect(extractJsonPayload(wrapped)).toEqual({ a: 1 })
  })

  it('склеивает ответ, разбитый на части', () => {
    const split = { candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] } }] }
    expect(extractJsonPayload(split)).toEqual({ a: 1 })
  })

  it('объясняет отказ модели, а не молчит', () => {
    expect(() => extractJsonPayload({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } }))
      .toThrow(/SAFETY/)
  })

  it('падает на пустом ответе', () => {
    expect(() => extractJsonPayload({})).toThrow()
    expect(() => extractJsonPayload({ candidates: [{ content: { parts: [] } }] })).toThrow()
  })
})

/**
 * Провайдеры расходятся в ОДНОЙ существенной детали — порядке чисел в рамке.
 * У Gemini y идёт первым, у Qwen — x. Перепутать легко, а заметить трудно:
 * на квадратной картинке ошибка выглядит как «модель промахнулась», а не как
 * баг. Поэтому проверяем оба порядка на заведомо несимметричной рамке.
 */
describe('порядок координат по провайдерам', () => {
  const RECT = { x: 0.2, y: 0.1, w: 0.4, h: 0.2 }

  it('Gemini: box_2d = [ymin, xmin, ymax, xmax]', () => {
    expect(boxToRect([100, 200, 300, 600], 'yxyx')).toEqual(RECT)
  })

  it('Qwen: bbox_2d = [x1, y1, x2, y2] — те же цифры дают ту же рамку', () => {
    expect(boxToRect([200, 100, 600, 300], 'xyxy')).toEqual(RECT)
  })

  it('перепутанный порядок даёт ДРУГУЮ рамку — значит, тест не самообман', () => {
    expect(boxToRect([100, 200, 300, 600], 'xyxy')).not.toEqual(RECT)
  })

  it('по умолчанию порядок Gemini — прежнее поведение не менялось', () => {
    expect(boxToRect([100, 200, 300, 600])).toEqual(RECT)
  })

  it('parseCheckResponse принимает bbox_2d и учитывает порядок Qwen', () => {
    const parsed = parseCheckResponse(
      {
        readable: true, summary: 'ок', suggested_score: 4, confidence: 'high',
        findings: [{ file_index: 0, page: 1, bbox_2d: [200, 100, 600, 300], category: 'logic', text: 'тут' }],
      },
      1,
      'xyxy',
    )
    expect(parsed.findings).toHaveLength(1)
    expect(parsed.findings[0].rect).toEqual(RECT)
  })
})

describe('parseJsonText — модели без жёсткой схемы', () => {
  it('читает чистый JSON', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 })
  })

  it('снимает markdown-обёртку', () => {
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it('вытаскивает объект из болтовни вокруг', () => {
    // Режим json_object не гарантирует чистоту ответа так, как json_schema:
    // модель может добавить вежливую фразу до или после.
    expect(parseJsonText('Вот разбор: {"a":1} Надеюсь, помог.')).toEqual({ a: 1 })
  })

  it('падает, когда JSON-а нет вовсе', () => {
    expect(() => parseJsonText('извините, не могу')).toThrow()
    expect(() => parseJsonText('   ')).toThrow()
  })
})

describe('extractOpenAiPayload', () => {
  const ok = (content: string) => ({ choices: [{ message: { content }, finish_reason: 'stop' }] })

  it('достаёт JSON из ответа chat/completions', () => {
    expect(extractOpenAiPayload(ok('{"a":1}'))).toEqual({ a: 1 })
  })

  it('объясняет обрыв по лимиту токенов человеческими словами', () => {
    // Здесь JSON валидный, но недописанный: без этой ветки преподаватель
    // увидел бы «Ответ модели — не JSON» и не понял бы, что делать.
    const cut = { choices: [{ message: { content: '{"readable":true,"find' }, finish_reason: 'length' }] }
    expect(() => extractOpenAiPayload(cut)).toThrow(/не поместился/)
  })

  it('показывает ошибку провайдера, а не «пустой ответ»', () => {
    expect(() => extractOpenAiPayload({ error: { message: 'Insufficient credits' } }))
      .toThrow(/Insufficient credits/)
  })

  it('падает на ответе без содержимого', () => {
    expect(() => extractOpenAiPayload({ choices: [{ message: {} }] })).toThrow()
  })
})

/**
 * Выбор провайдера — единственное, что владелец будет трогать руками
 * (переменные окружения в панели Supabase). Ошибка здесь тихая и дорогая:
 * запрос уйдёт не в ту модель, а понять это по интерфейсу невозможно.
 */
describe('resolveProvider — настройка окружением', () => {
  const env = (vars: Record<string, string>) => (key: string) => vars[key]

  it('по умолчанию — Qwen через OpenRouter, порядок координат x-первый', () => {
    const p = resolveProvider(env({ AI_API_KEY: 'k' }))!
    expect(p.kind).toBe('openai')
    expect(p.model).toBe('qwen/qwen3.7-plus')
    expect(p.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(p.boxOrder).toBe('xyxy')
    expect(p.supportsJsonSchema).toBe(false)
    expect(providerLabel(p)).toBe('openrouter')
  })

  it('без ключа не настроен — функция обязана честно ответить 503', () => {
    expect(resolveProvider(env({}))).toBeNull()
    expect(resolveProvider(env({ AI_PROVIDER: 'gemini' }))).toBeNull()
  })

  it('Gemini включается одной переменной и приносит свой порядок координат', () => {
    const p = resolveProvider(env({ AI_PROVIDER: 'gemini', AI_API_KEY: 'k' }))!
    expect(p.kind).toBe('gemini')
    expect(p.model).toBe('gemini-3.1-pro-preview')
    expect(p.boxOrder).toBe('yxyx')
    expect(p.supportsJsonSchema).toBe(true)
    expect(providerLabel(p)).toBe('google')
  })

  it('старый GEMINI_API_KEY продолжает работать', () => {
    // Ключ уже мог быть заведён до появления второго провайдера — ломать
    // настройку сменой имени переменной нельзя.
    const p = resolveProvider(env({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-3.6-flash' }))!
    expect(p.apiKey).toBe('k')
    expect(p.model).toBe('gemini-3.6-flash')
  })

  it('модель и адрес меняются без правки кода', () => {
    const p = resolveProvider(env({
      AI_API_KEY: 'k',
      AI_MODEL: 'qwen3-vl-plus',
      AI_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/',
    }))!
    expect(p.model).toBe('qwen3-vl-plus')
    // Хвостовой слэш убираем — иначе получится //chat/completions.
    expect(p.baseUrl).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1')
    expect(providerLabel(p)).toBe('alibaba')
  })

  it('порядок координат можно переопределить, если модель поведёт себя иначе', () => {
    const p = resolveProvider(env({ AI_API_KEY: 'k', AI_BOX_ORDER: 'yxyx' }))!
    expect(p.boxOrder).toBe('yxyx')
  })
})
