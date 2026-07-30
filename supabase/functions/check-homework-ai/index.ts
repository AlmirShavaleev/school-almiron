/**
 * Edge Function: check-homework-ai
 *
 * Готовит ЧЕРНОВИК проверки домашней работы: рамки на местах ошибок,
 * предлагаемый балл и текст обратной связи. Результат кладётся в
 * topic_homework_ai_jobs / topic_homework_ai_findings и ждёт преподавателя.
 *
 * В topic_homework_reviews функция не пишет и писать не должна: вердикт и
 * балл ученику ставит человек. Это решение владельца и оно закреплено
 * отсутствием у функции соответствующего кода, а не только договорённостью.
 *
 * Вызывается преподавателем из интерфейса разбора работы. Права проверяет
 * БАЗА: функция дёргает topic_homework_ai_request_check от имени вызывающего,
 * и та падает, если он не персонал курса. Своей копии проверки прав здесь
 * нет — по правилу проекта (CLAUDE.md) такие копии рано или поздно
 * расходятся с course_is_staff.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fitScoreToScale } from './parse.ts'
import {
  providerLabel,
  resolveProvider,
  runProvider,
  type ImagePart,
} from './providers.ts'
import { buildSystemPrompt } from './prompt.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ATTEMPTS_BUCKET = 'topic-homework-attempts'
const HOMEWORK_BUCKET = 'topic-homework'

/*
 * Выбор модели и провайдера живёт в providers.ts: владелец решил сначала
 * попробовать Qwen (примерно на порядок дешевле Gemini), а какая из моделей
 * лучше читает русский рукописный текст — не знает никто. Поэтому провайдер
 * переключается переменными окружения, без правки кода и передеплоя.
 */

/** Больше этого одним файлом не отправляем: у запроса есть предел, а фото с телефона бывают тяжёлыми. */
const MAX_FILE_BYTES = 7 * 1024 * 1024
const MAX_TOTAL_BYTES = 18 * 1024 * 1024
const MAX_FILES = 12

/*
 * Gemini принимает PDF напрямую, OpenAI-совместимые провайдеры — далеко не
 * все и не одинаково. Поэтому набор форматов зависит от провайдера: лучше
 * честно сказать «ИИ не может прочитать этот файл», чем отправить и получить
 * невнятную ошибку от чужого API.
 */
const IMAGE_MIME = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'image/heic', 'image/heif',
]
const supportedMime = (kind: 'gemini' | 'openai') =>
  new Set(kind === 'gemini' ? [...IMAGE_MIME, 'application/pdf'] : IMAGE_MIME)

interface AttemptFile {
  id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  position: number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** base64 порциями: btoa на мегабайтном файле переполняет стек аргументов. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function guessMime(path: string, declared: string | null, allowed: Set<string>): string | null {
  if (declared && allowed.has(declared.toLowerCase())) return declared.toLowerCase()
  const ext = path.toLowerCase().split('.').pop() ?? ''
  const byExt: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
  }
  const byExtension = byExt[ext] ?? null
  return byExtension && allowed.has(byExtension) ? byExtension : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405)

  const provider = resolveProvider(key => Deno.env.get(key))
  if (!provider) {
    // Fail-closed и с внятным текстом: без ключа фича просто не настроена,
    // и преподаватель должен увидеть это, а не «что-то пошло не так».
    return json({ error: 'ИИ-проверка не настроена: не задан ключ модели (AI_API_KEY)' }, 503)
  }
  const model = provider.model

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  let attemptId: string
  try {
    const body = await req.json()
    attemptId = String(body?.attempt_id ?? '')
    if (!/^[0-9a-fA-F-]{36}$/.test(attemptId)) throw new Error('bad id')
  } catch {
    return json({ error: 'Нужен attempt_id' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Клиент от имени вызывающего — только чтобы БАЗА решила вопрос прав.
  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── 1. Ставим задачу. Права и идемпотентность — внутри RPC ────────────
  const { data: jobId, error: reqErr } = await asCaller
    .rpc('topic_homework_ai_request_check', { p_attempt_id: attemptId })

  if (reqErr) return json({ error: reqErr.message }, 403)
  if (!jobId) return json({ error: 'Не удалось поставить задачу проверки' }, 500)

  const failJob = async (message: string, status = 500) => {
    await admin.from('topic_homework_ai_jobs')
      .update({ status: 'failed', last_error: message.slice(0, 1000), completed_at: new Date().toISOString() })
      .eq('id', jobId)
    return json({ error: message, job_id: jobId }, status)
  }

  try {
    await admin.from('topic_homework_ai_jobs')
      .update({ status: 'processing', started_at: new Date().toISOString(), provider: providerLabel(provider), model })
      .eq('id', jobId)

    // ── 2. Собираем контекст: задание + работа ученика ──────────────────
    const { data: attempt, error: attErr } = await admin
      .from('topic_homework_attempts')
      .select('id, homework_id, topic_homework!inner(id, title, instructions, grade_scale)')
      .eq('id', attemptId)
      .single()

    if (attErr || !attempt) return await failJob('Работа не найдена')
    const homework = (attempt as any).topic_homework

    const [{ data: workFiles }, { data: taskFiles }] = await Promise.all([
      admin.from('topic_homework_attempt_files')
        .select('id, storage_path, file_name, mime_type, size_bytes, position')
        .eq('attempt_id', attemptId).order('position'),
      admin.from('topic_homework_files')
        .select('storage_path, original_filename, mime_type, size_bytes, position')
        .eq('homework_id', homework.id).order('position'),
    ])

    const allowedMime = supportedMime(provider.kind)
    const work = ((workFiles ?? []) as AttemptFile[])
      .filter(f => guessMime(f.storage_path, f.mime_type, allowedMime) !== null)
      .slice(0, MAX_FILES)

    if (work.length === 0) {
      return await failJob(
        provider.kind === 'gemini'
          ? 'В работе нет файлов, которые ИИ может прочитать (нужны фото или PDF)'
          : 'В работе нет фотографий. Выбранная модель читает только картинки — PDF она не принимает',
      )
    }

    let totalBytes = 0
    const images: ImagePart[] = []

    const attach = async (
      bucket: string, path: string, mime: string, label: string,
    ): Promise<boolean> => {
      const { data: blob, error } = await admin.storage.from(bucket).download(path)
      if (error || !blob) return false
      const buf = new Uint8Array(await blob.arrayBuffer())
      if (buf.length > MAX_FILE_BYTES || totalBytes + buf.length > MAX_TOTAL_BYTES) return false
      totalBytes += buf.length
      images.push({ mimeType: mime, data: toBase64(buf), label })
      return true
    }

    // Файлы задания идут первыми и явно помечены — иначе модель принимает
    // условие за часть работы ученика и «находит» в нём ошибки.
    let taskFilesAttached = 0
    for (const f of (taskFiles ?? []) as any[]) {
      const mime = guessMime(f.storage_path, f.mime_type, allowedMime)
      if (!mime) continue
      if (await attach(HOMEWORK_BUCKET, f.storage_path, mime, `[ФАЙЛ ЗАДАНИЯ] ${f.original_filename ?? ''}`)) {
        taskFilesAttached++
      }
    }

    const attachedWork: AttemptFile[] = []
    for (const f of work) {
      const mime = guessMime(f.storage_path, f.mime_type, allowedMime)!
      const idx = attachedWork.length
      if (await attach(ATTEMPTS_BUCKET, f.storage_path, mime, `[РАБОТА УЧЕНИКА] file_index ${idx}: ${f.file_name}`)) {
        attachedWork.push(f)
      }
    }

    if (attachedWork.length === 0) {
      return await failJob('Файлы работы слишком большие или недоступны — ИИ не смог их прочитать')
    }

    const systemPrompt = buildSystemPrompt({
      homeworkTitle: homework.title ?? 'Домашнее задание',
      instructions: homework.instructions ?? null,
      gradeScale: homework.grade_scale ?? null,
      hasTaskFiles: taskFilesAttached > 0,
      workFileNames: attachedWork.map(f => f.file_name),
      boxOrder: provider.boxOrder,
      // Без жёсткой схемы форму ответа приходится описывать словами.
      describeJsonShape: !provider.supportsJsonSchema,
    })

    // ── 3. Спрашиваем модель ───────────────────────────────────────────
    const parsed = await runProvider(provider, systemPrompt, images, attachedWork.length)

    // ── 4. Записываем черновик ─────────────────────────────────────────
    const score = fitScoreToScale(parsed.suggestedScore, homework.grade_scale ?? null)

    if (parsed.findings.length > 0) {
      const rows = parsed.findings.map((f, i) => ({
        job_id: jobId,
        file_id: attachedWork[f.fileIndex].id,
        page: f.page,
        rect_x: f.rect.x, rect_y: f.rect.y, rect_w: f.rect.w, rect_h: f.rect.h,
        category: f.category,
        text: f.text,
        position: i,
      }))
      const { error: insErr } = await admin.from('topic_homework_ai_findings').insert(rows)
      // Рамки — не всё: текст разбора полезен и без них. Поэтому сбой вставки
      // рамок не отменяет весь прогон, а честно пишется в last_error.
      if (insErr) console.error('findings insert failed', insErr.message)
    }

    await admin.from('topic_homework_ai_jobs').update({
      status: 'done',
      readable: parsed.readable,
      suggested_score: score,
      confidence: parsed.confidence,
      summary: parsed.summary,
      input_tokens: parsed.inputTokens,
      output_tokens: parsed.outputTokens,
      completed_at: new Date().toISOString(),
      last_error: parsed.suggestedScore != null && score == null
        ? 'Модель предложила балл вне шкалы задания — балл отброшен, разбор сохранён'
        : null,
    }).eq('id', jobId)

    return json({
      job_id: jobId,
      readable: parsed.readable,
      suggested_score: score,
      confidence: parsed.confidence,
      findings: parsed.findings.length,
    })
  } catch (e) {
    return await failJob(e instanceof Error ? e.message : 'Неизвестная ошибка ИИ-проверки')
  }
})
