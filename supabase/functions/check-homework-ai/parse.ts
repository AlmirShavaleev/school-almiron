/**
 * Разбор ответа модели для ИИ-проверки ДЗ — чистая часть, без сети.
 *
 * Общая для всех провайдеров: здесь живут все допущения о том, что модель
 * вернёт, а модель — вещь непослушная. Именно поэтому вынесено из index.ts,
 * это единственный кусок, который можно прогнать тестами.
 *
 * Провайдеры отличаются одной существенной деталью — ПОРЯДКОМ координат
 * в рамке, см. BoxOrder ниже.
 */

/**
 * Порядок чисел в рамке. Различие не косметическое: перепутать — значит
 * получить рамки, повёрнутые относительно правильных, и не заметить этого
 * на квадратных картинках.
 *
 *  - 'yxyx' — Gemini: box_2d = [ymin, xmin, ymax, xmax]
 *  - 'xyxy' — Qwen:   bbox_2d = [x1, y1, x2, y2]
 *
 * Шкала у обоих одна — 0..1000 от размера изображения. (Qwen формально
 * рекомендует делить на 999 ради обратной совместимости; разница 0.1%,
 * то есть меньше пикселя на странице, и ею можно пренебречь.)
 */
export type BoxOrder = 'yxyx' | 'xyxy'

/** Категории пометок совпадают с человеческими (SubmissionReviewer.CATEGORIES). */
export const FINDING_CATEGORIES = ['comment', 'calc', 'logic', 'format', 'praise'] as const
export type FindingCategory = (typeof FINDING_CATEGORIES)[number]

export interface ParsedFinding {
  fileIndex: number
  page: number
  rect: { x: number; y: number; w: number; h: number }
  category: FindingCategory
  text: string
}

export interface ParsedCheck {
  readable: boolean
  summary: string
  suggestedScore: number | null
  confidence: 'high' | 'medium' | 'low'
  findings: ParsedFinding[]
}

/**
 * Схема структурированного ответа. Gemini умеет отдавать JSON по схеме, и это
 * заметно надёжнее, чем просить «ответь JSON-ом» словами: без схемы модель
 * периодически возвращает markdown-обёртку или обрывает объект.
 *
 * box_2d — родной формат Gemini для рамок: [ymin, xmin, ymax, xmax] в шкале
 * 0..1000. Просить у модели «свой» формат хуже: на родном она обучена.
 */
export const CHECK_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description: 'Удалось ли разобрать почерк и содержание работы настолько, чтобы её оценивать.',
    },
    summary: {
      type: 'string',
      description: 'Обратная связь ученику: что верно, где ошибка и почему. По-русски, без обращения к преподавателю.',
    },
    suggested_score: {
      type: 'integer',
      description: 'Предлагаемый балл в заданной шкале. null, если оценить невозможно.',
      nullable: true,
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    findings: {
      type: 'array',
      description: 'Места в работе, к которым есть замечание или похвала.',
      items: {
        type: 'object',
        properties: {
          file_index: { type: 'integer', description: 'Номер файла работы, начиная с 0.' },
          page: { type: 'integer', description: 'Страница внутри файла, начиная с 1.' },
          box_2d: {
            type: 'array',
            description: 'Рамка [ymin, xmin, ymax, xmax] в шкале 0..1000.',
            items: { type: 'integer' },
          },
          category: { type: 'string', enum: [...FINDING_CATEGORIES] },
          text: { type: 'string', description: 'Короткое пояснение к этому месту, по-русски.' },
        },
        required: ['file_index', 'page', 'box_2d', 'category', 'text'],
      },
    },
  },
  required: ['readable', 'summary', 'suggested_score', 'confidence', 'findings'],
} as const

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Переводит рамку модели в нормализованный прямоугольник annotation_sets.
 *
 * Возвращает null для всего, что нельзя показать: перепутанного порядка
 * координат, значений вне шкалы, вырожденной рамки. Отбрасывать такое молча
 * правильнее, чем чинить догадками: рамка не там, где ошибка, хуже, чем её
 * отсутствие — преподаватель пойдёт искать ошибку в чистом месте.
 */
export function boxToRect(
  box: unknown,
  order: BoxOrder = 'yxyx',
): { x: number; y: number; w: number; h: number } | null {
  if (!Array.isArray(box) || box.length !== 4) return null
  const nums = box.map(v => (typeof v === 'number' ? v : Number(v)))
  if (nums.some(n => !Number.isFinite(n))) return null

  const [ymin, xmin, ymax, xmax] = order === 'yxyx'
    ? nums
    : [nums[1], nums[0], nums[3], nums[2]]
  // Шкала 0..1000. Небольшой выход за край терпим (модель округляет), сильный
  // означает, что она отдала пиксели или что-то своё — такому верить нельзя.
  if (nums.some(n => n < -10 || n > 1010)) return null

  const x = clamp01(Math.min(xmin, xmax) / 1000)
  const y = clamp01(Math.min(ymin, ymax) / 1000)
  const w = clamp01(Math.abs(xmax - xmin) / 1000)
  const h = clamp01(Math.abs(ymax - ymin) / 1000)

  // Меньше 0.5% страницы — это точка, а не рамка: попасть ей в нужную строку
  // модель не могла, скорее всего это шум.
  if (w < 0.005 || h < 0.005) return null

  return {
    x,
    y,
    w: Math.min(w, 1 - x),
    h: Math.min(h, 1 - y),
  }
}

/**
 * Приводит ответ модели к тому, что можно положить в базу.
 *
 * Всё, чему нельзя доверять, отбрасывается поштучно: одна кривая находка не
 * должна отменять остальные пятнадцать. Ошибка целиком — только если разобрать
 * нечего вовсе.
 */
export function parseCheckResponse(
  raw: unknown,
  fileCount: number,
  order: BoxOrder = 'yxyx',
): ParsedCheck {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Модель вернула не объект')
  }
  const obj = raw as Record<string, unknown>

  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : ''
  if (!summary) throw new Error('Модель не вернула текст разбора')

  const readable = obj.readable !== false
  const confidence =
    obj.confidence === 'high' || obj.confidence === 'medium' || obj.confidence === 'low'
      ? obj.confidence
      : 'low'

  let suggestedScore: number | null = null
  if (typeof obj.suggested_score === 'number' && Number.isFinite(obj.suggested_score)) {
    suggestedScore = Math.round(obj.suggested_score)
  }
  // Балл при нечитаемой работе — противоречие: модель сама сказала, что не
  // разобрала её. Верим первому утверждению, а не второму.
  if (!readable) suggestedScore = null

  const findings: ParsedFinding[] = []
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : []
  for (const item of rawFindings) {
    if (!item || typeof item !== 'object') continue
    const f = item as Record<string, unknown>

    const text = typeof f.text === 'string' ? f.text.trim() : ''
    if (!text) continue

    const category = FINDING_CATEGORIES.includes(f.category as FindingCategory)
      ? (f.category as FindingCategory)
      : 'comment'

    // Ключ отличается у провайдеров (box_2d у Gemini, bbox_2d у Qwen) —
    // принимаем оба, чтобы модель не наказывала нас за свою же привычку.
    const rect = boxToRect(f.box_2d ?? f.bbox_2d, order)
    if (!rect) continue

    const fileIndex = Number(f.file_index)
    // Ссылка на несуществующий файл — рамку некуда положить.
    if (!Number.isInteger(fileIndex) || fileIndex < 0 || fileIndex >= fileCount) continue

    const pageRaw = Number(f.page)
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1

    findings.push({
      fileIndex,
      page,
      rect,
      category,
      text: text.slice(0, 2000),
    })
  }

  return {
    readable,
    summary: summary.slice(0, 8000),
    suggestedScore,
    confidence,
    findings,
  }
}

/**
 * Ограничивает балл шкалой ДЗ.
 *
 * Модель регулярно предлагает «4» там, где шкала стобалльная, и «85» там, где
 * пятибалльная. Вписать это в базу нельзя — там CHECK, — но и терять весь
 * разбор из-за балла жалко: текст и рамки полезны сами по себе. Поэтому
 * негодный балл убираем, оставляя null.
 */
export function fitScoreToScale(score: number | null, gradeScale: string | null): number | null {
  if (score == null) return null
  const max = gradeScale === 'five' ? 5 : gradeScale === 'hundred' ? 100 : null
  if (max == null) return null
  if (score < 0 || score > max) return null
  return score
}

/**
 * Достаёт JSON из текста, чем бы его ни обернули.
 *
 * Отдельно от извлечения из конверта провайдера: модели без поддержки
 * json_schema (Qwen умеет только json_object) периодически оборачивают ответ
 * в markdown, и терять из-за этого весь разбор было бы обидно.
 */
export function parseJsonText(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Модель вернула пустой текст')
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    if (fenced) return JSON.parse(fenced[1])
    // Последняя попытка: вытащить самый внешний объект из болтовни вокруг.
    const first = trimmed.indexOf('{')
    const last = trimmed.lastIndexOf('}')
    if (first !== -1 && last > first) return JSON.parse(trimmed.slice(first, last + 1))
    throw new Error('Ответ модели — не JSON')
  }
}

/** Достаёт JSON из ответа Gemini, не полагаясь на то, что там ровно одна часть. */
export function extractJsonPayload(response: unknown): unknown {
  const candidates = (response as any)?.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const blockReason = (response as any)?.promptFeedback?.blockReason
    throw new Error(
      blockReason
        ? `Модель отказалась разбирать работу (${blockReason})`
        : 'Модель вернула пустой ответ',
    )
  }
  const parts = candidates[0]?.content?.parts
  if (!Array.isArray(parts)) throw new Error('В ответе модели нет содержимого')

  const text = parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
    .join('')
    .trim()
  if (!text) throw new Error('В ответе модели нет текста')
  return parseJsonText(text)
}

/** То же для ответа OpenAI-совместимого API (Qwen через OpenRouter или Model Studio). */
export function extractOpenAiPayload(response: unknown): unknown {
  const choice = (response as any)?.choices?.[0]
  if (!choice) {
    const err = (response as any)?.error?.message
    throw new Error(err ? `Модель ответила ошибкой: ${err}` : 'Модель вернула пустой ответ')
  }
  // Обрыв по лимиту токенов даёт валидный, но недописанный JSON — объясняем
  // это словами, иначе преподаватель увидит «Ответ модели — не JSON».
  if (choice.finish_reason === 'length') {
    throw new Error('Ответ модели не поместился в лимит — разбор оборван')
  }
  const content = choice.message?.content
  if (typeof content !== 'string') throw new Error('В ответе модели нет текста')
  return parseJsonText(content)
}
