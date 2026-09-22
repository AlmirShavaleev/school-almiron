// §213. «Переписать по таблице»: общий комментарий к работе заново, по уже
// ИСПРАВЛЕННОЙ преподавателем таблице заданий.
//
// Зачем отдельная функция, а не режим внутри `check-homework-ai`:
//
//  * чтобы переписать комментарий, страницы работы НЕ нужны — нужны таблица и
//    замечания. Нет рендера PDF — нет бюджета процессора (§48) и нет риска
//    получить вечный спиннер (§196);
//  * вызов текстовый и дешёвый: пара тысяч знаков вместо пачки картинок;
//  * модель может быть другая, не та, что читает почерк, — и задаётся она
//    своей переменной окружения;
//  * качество `check-homework-ai` только что выправляли (v21), и подмешивать
//    в неё второй сценарий — верный способ сломать первый.
//
// ДЕПЛОЙ: `verify_jwt` = **true**. Функция работает от имени вызывающего и
// без токена бессмысленна.
//
// ПОРЯДОК ПРАВ (тот же, что у `check-homework-ai` и `student-feedback-ai`):
// сначала проверяем вызывающего ЕГО ЖЕ токеном через
// `topic_homework_attempt_can_review`, и только потом читаем данные. Своих
// проверок прав не изобретаем: правило «персонал ли по курсу» живёт в базе
// (`course_is_staff`, CLAUDE.md), и вторая копия породила бы §21/§29.
//
// ВХОД — только `attempt_id`. Всё остальное функция читает сама: приняв
// таблицу от клиента, мы дали бы любому вошедшему наврать модели про чужую
// работу.
//
// В БАЗУ НИЧЕГО НЕ ПИШЕМ. Текст возвращается предложением, вставляет его
// преподаватель — это v1 и намеренно.
//
// ПРОВАЙДЕР. OpenAI-совместимый `/chat/completions`. Модель —
// REWRITE_COMMENT_MODEL (СВОЯ, не `AI_MODEL`: смысл в том, чтобы менять её
// отдельно от проверки почерка). База и ключ общие с остальными функциями:
// AI_BASE_URL, AI_API_KEY (запасное имя — OPENROUTER_API_KEY). Ключ нигде не
// печатается и не логируется.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  SYSTEM_PROMPT,
  buildModelInput,
  refuseReason,
  userMessage,
  type RewriteNoteSource,
} from './prompt.ts'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
/**
 * Недорогая текстовая модель по умолчанию: читать почерк здесь не надо, и
 * платить за зрительную модель не за что.
 */
const DEFAULT_MODEL = 'qwen/qwen3-30b-a3b-instruct'
const MAX_TOKENS = 500

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Регион разметки: рамка с привязкой к заданию (§209). */
type Region = { type?: string; task?: unknown; text?: unknown }

/**
 * Замечания преподавателя из `annotation_sets`. Берём только регионы с
 * текстом: легаси-штампы и линии (`stroke`, `stamp`) текста не несут.
 */
function notesFromAnnotations(rows: readonly { data?: unknown }[]): RewriteNoteSource[] {
  const notes: RewriteNoteSource[] = []
  for (const row of rows) {
    const objects = (row?.data as { objects?: unknown } | null)?.objects
    if (!Array.isArray(objects)) continue
    for (const raw of objects) {
      const mark = (raw ?? {}) as Region
      if (mark.type !== 'region') continue
      if (typeof mark.text !== 'string' || mark.text.trim().length === 0) continue
      notes.push({ task: mark.task, text: mark.text })
    }
  }
  return notes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  try {
    const body = await req.json().catch(() => ({}))
    const attemptId = String(body?.attempt_id ?? '').trim()
    if (!attemptId) return fail(400, 'Не передан идентификатор работы')

    // Шаг 1. Права вызывающего — его собственным токеном, обычными политиками.
    const asUser = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: canReview, error: rightsError } = await asUser
      .rpc('topic_homework_attempt_can_review', { p_attempt_id: attemptId })
    if (rightsError) return fail(403, rightsError.message)
    if (canReview !== true) return fail(403, 'Эта работа вам недоступна')

    // Шаг 2. Факты. Читаем тем же клиентом: RLS — единственная проверка, и
    // сервисный ключ здесь не нужен вовсе.
    const [tasksRes, notesRes, attemptRes] = await Promise.all([
      asUser.from('topic_homework_review_tasks')
        .select('no,verdict,expected_answer,position')
        .eq('attempt_id', attemptId)
        .order('position'),
      asUser.from('annotation_sets')
        .select('data')
        .eq('attempt_id', attemptId),
      asUser.from('topic_homework_attempts')
        .select('id,homework:topic_homework!inner(title,grade_scale,topic:topics!inner(title))')
        .eq('id', attemptId)
        .maybeSingle(),
    ])
    if (tasksRes.error) return fail(500, tasksRes.error.message)

    const homework = (attemptRes.data as any)?.homework ?? null
    const input = buildModelInput({
      tasks: tasksRes.data ?? [],
      // Ошибка чтения разметки не должна ронять переписывание: замечания —
      // приятное дополнение, таблица — обязательное.
      notes: notesRes.error ? [] : notesFromAnnotations(notesRes.data ?? []),
      homeworkTitle: homework?.title,
      topicTitle: homework?.topic?.title,
      gradeScale: homework?.grade_scale,
    })

    const refuse = refuseReason(input)
    if (refuse) return fail(400, refuse)

    // Шаг 3. Модель.
    const apiKey = Deno.env.get('AI_API_KEY') ?? Deno.env.get('OPENROUTER_API_KEY')
    if (!apiKey) return fail(500, 'Переменная AI_API_KEY не настроена в проекте')
    const model = Deno.env.get('REWRITE_COMMENT_MODEL') || DEFAULT_MODEL
    const baseUrl = (Deno.env.get('AI_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '')

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage(input) },
        ],
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return fail(502, `Модель ответила ошибкой ${response.status}: ${detail.slice(0, 300)}`)
    }

    const completion = await response.json()
    const text = String(completion?.choices?.[0]?.message?.content ?? '').trim()
    if (!text) return fail(502, 'Модель вернула пустой ответ')

    // Числа токенов уезжают наружу намеренно: по ним считают бюджет и
    // решают, менять ли модель.
    return json(200, {
      text,
      model,
      usage: completion?.usage ?? null,
      tasks: input.summary,
    })
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : 'Непредвиденная ошибка')
  }
})

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

function fail(status: number, message: string) {
  return json(status, { error: message })
}
