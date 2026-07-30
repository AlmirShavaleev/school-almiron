/**
 * Провайдеры моделей для ИИ-проверки ДЗ.
 *
 * Два вызова с одинаковым контрактом: получить систему + картинки, вернуть
 * разобранный черновик и потраченные токены. Всё остальное (права, storage,
 * запись в базу) провайдера не касается.
 *
 * Почему абстракция появилась: владелец выбрал сначала попробовать Qwen —
 * он дешевле Gemini примерно на порядок. Но кто из них лучше читает русский
 * рукописный текст и точнее ставит рамки, неизвестно НИКОМУ: у Qwen в
 * документации про почерк нет ни слова, у Gemini есть только бенчмарки
 * печатных документов. Единственный способ узнать — прогнать одни и те же
 * работы через обоих. Значит, смена модели обязана быть настройкой, а не
 * правкой кода.
 */

import {
  CHECK_RESPONSE_SCHEMA,
  extractJsonPayload,
  extractOpenAiPayload,
  parseCheckResponse,
  type BoxOrder,
  type ParsedCheck,
} from './parse.ts'

export interface ImagePart {
  mimeType: string
  /** base64 без префикса data: */
  data: string
  /** Подпись перед картинкой: файл задания или работа ученика. */
  label: string
}

export interface ProviderConfig {
  kind: 'gemini' | 'openai'
  model: string
  apiKey: string
  baseUrl: string
  boxOrder: BoxOrder
  /** Умеет ли провайдер жёсткую схему ответа, а не просто «верни JSON». */
  supportsJsonSchema: boolean
}

export interface ProviderResult extends ParsedCheck {
  inputTokens: number | null
  outputTokens: number | null
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * Модель по умолчанию — qwen3.7-plus через OpenRouter.
 *
 * Почему именно она из линейки Qwen: у неё по данным каталога OpenRouter
 * подтверждены ОБА нужных свойства — приём изображений и структурированный
 * вывод. У части VL-моделей второго нет, а без него ответ приходится
 * выковыривать из свободного текста. Цена $0.32/$1.28 против $2/$12 у
 * Gemini 3.1 Pro — примерно в восемь раз дешевле на нашей нагрузке.
 *
 * Если качества не хватит, следующая ступень — 'qwen/qwen3.7-max'
 * ($1.25/$3.75), и она всё равно дешевле Gemini. Меняется переменной
 * AI_MODEL, без передеплоя.
 */
const DEFAULT_OPENAI_MODEL = 'qwen/qwen3.7-plus'
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-pro-preview'

/**
 * Собирает конфигурацию из окружения.
 *
 * Ключ ищем в трёх местах ради совместимости: AI_API_KEY — общий,
 * GEMINI_API_KEY — как было до появления второго провайдера.
 */
export function resolveProvider(env: (key: string) => string | undefined): ProviderConfig | null {
  const kind = (env('AI_PROVIDER') ?? 'openai').toLowerCase() === 'gemini' ? 'gemini' : 'openai'

  if (kind === 'gemini') {
    const apiKey = env('AI_API_KEY') ?? env('GEMINI_API_KEY')
    if (!apiKey) return null
    return {
      kind: 'gemini',
      model: env('AI_MODEL') ?? env('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL,
      apiKey,
      baseUrl: env('AI_BASE_URL') ?? GEMINI_BASE,
      boxOrder: 'yxyx',
      supportsJsonSchema: true,
    }
  }

  const apiKey = env('AI_API_KEY') ?? env('OPENROUTER_API_KEY')
  if (!apiKey) return null
  return {
    kind: 'openai',
    model: env('AI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    apiKey,
    baseUrl: (env('AI_BASE_URL') ?? OPENROUTER_BASE).replace(/\/+$/, ''),
    // Qwen отдаёт [x1, y1, x2, y2] — x первым, в отличие от Gemini.
    boxOrder: (env('AI_BOX_ORDER') as BoxOrder) === 'yxyx' ? 'yxyx' : 'xyxy',
    // Model Studio у Alibaba поддерживает только json_object, без схемы.
    // OpenRouter для qwen3.7-plus заявляет structured_outputs, но полагаться
    // на это по умолчанию не будем: json_object работает везде, а форму
    // ответа всё равно описывает промпт и стережёт разбор.
    supportsJsonSchema: env('AI_JSON_SCHEMA') === '1',
  }
}

/** Понятное имя провайдера для строки в базе — чтобы потом сравнивать прогоны. */
export function providerLabel(config: ProviderConfig): string {
  if (config.kind === 'gemini') return 'google'
  if (config.baseUrl.includes('openrouter')) return 'openrouter'
  if (config.baseUrl.includes('aliyuncs')) return 'alibaba'
  return 'openai-compatible'
}

async function callGemini(
  config: ProviderConfig,
  systemPrompt: string,
  images: ImagePart[],
  fileCount: number,
): Promise<ProviderResult> {
  const parts: Array<Record<string, unknown>> = []
  for (const img of images) {
    parts.push({ text: img.label })
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } })
  }

  const res = await fetch(`${config.baseUrl}/models/${config.model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: CHECK_RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  })

  if (!res.ok) {
    throw new Error(`Модель ответила ошибкой ${res.status}: ${(await res.text()).slice(0, 400)}`)
  }
  const payload = await res.json()
  const parsed = parseCheckResponse(extractJsonPayload(payload), fileCount, config.boxOrder)
  const usage = payload?.usageMetadata ?? {}
  return {
    ...parsed,
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0) || null,
  }
}

async function callOpenAiCompatible(
  config: ProviderConfig,
  systemPrompt: string,
  images: ImagePart[],
  fileCount: number,
): Promise<ProviderResult> {
  const content: Array<Record<string, unknown>> = []
  for (const img of images) {
    content.push({ type: 'text', text: img.label })
    content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } })
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      // OpenRouter показывает это в статистике — удобно отличать расход
      // проверки ДЗ от прочего, если ключ используется ещё где-то.
      'HTTP-Referer': 'https://alminion.ru',
      'X-Title': 'Almiron homework check',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      response_format: config.supportsJsonSchema
        ? { type: 'json_schema', json_schema: { name: 'homework_check', schema: CHECK_RESPONSE_SCHEMA, strict: true } }
        : { type: 'json_object' },
      temperature: 0.2,
      // Разбор с рамками — длинный ответ. Без запаса модель обрывается на
      // середине findings, и весь прогон уходит впустую.
      max_tokens: 8000,
    }),
  })

  if (!res.ok) {
    throw new Error(`Модель ответила ошибкой ${res.status}: ${(await res.text()).slice(0, 400)}`)
  }
  const payload = await res.json()
  const parsed = parseCheckResponse(extractOpenAiPayload(payload), fileCount, config.boxOrder)
  const usage = payload?.usage ?? {}
  return {
    ...parsed,
    inputTokens: usage.prompt_tokens ?? null,
    outputTokens: usage.completion_tokens ?? null,
  }
}

export function runProvider(
  config: ProviderConfig,
  systemPrompt: string,
  images: ImagePart[],
  fileCount: number,
): Promise<ProviderResult> {
  return config.kind === 'gemini'
    ? callGemini(config, systemPrompt, images, fileCount)
    : callOpenAiCompatible(config, systemPrompt, images, fileCount)
}
