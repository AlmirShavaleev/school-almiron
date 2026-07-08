/**
 * Edge Function: lesson-reminder-scheduler
 * Находит занятия через 24 часа и через 1 час,
 * создаёт записи в notification_queue для каждого получателя.
 * НЕ отправляет в Telegram напрямую — этим занимается process-notification-queue.
 *
 * Окна поиска (безопасные, для cron каждые 5 мин):
 *   24h: scheduled_at IN [NOW()+23:55 .. NOW()+24:05]
 *    1h: scheduled_at IN [NOW()+0:55  .. NOW()+1:05]
 *
 * Получатели:
 *   - individual: lessons.student_id (= profile_id)
 *   - group/pair/parallel: group_students → students.profile_id
 *
 * Фильтры: только scheduled, Telegram подключён, prefs.lesson=true
 * Дедупликация: ON CONFLICT (deduplication_key) DO NOTHING
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

interface Lesson {
  id: string
  title: string
  scheduled_at: string
  status: string
  format: string
  group_id: string | null
  student_id: string | null
  teacher_id: string
  course_id: string | null
  zoom_link: string | null
}

interface Stats {
  lessons_checked: number
  recipients_checked: number
  queued_24h: number
  queued_1h: number
  duplicates_skipped: number
  errors: number
}

async function processWindow(
  supabase: ReturnType<typeof createClient>,
  windowLabel: '24h' | '1h',
  windowStart: string,
  windowEnd: string,
  tgActive: Set<string>,
  lessonPrefOn: Set<string>,
  stats: Stats,
): Promise<void> {
  // 1. Занятия в окне
  const { data: lessons, error: lErr } = await supabase
    .from('lessons')
    .select('id, title, scheduled_at, status, format, group_id, student_id, teacher_id, course_id, zoom_link')
    .eq('status', 'scheduled')
    .gte('scheduled_at', windowStart)
    .lte('scheduled_at', windowEnd)

  if (lErr) {
    console.error(`lesson-reminder-scheduler [${windowLabel}] fetch error:`, lErr.message)
    stats.errors++
    return
  }

  if (!lessons || lessons.length === 0) return
  stats.lessons_checked += lessons.length

  // 2. Имена учителей (teacher_id → teachers.profile_id → profiles.full_name)
  const teacherIds = [...new Set((lessons as Lesson[]).map(l => l.teacher_id))]
  const { data: teacherRows } = await supabase
    .from('teachers')
    .select('id, profile_id, profiles!inner(full_name)')
    .in('id', teacherIds)

  const teacherNameById: Record<string, string> = {}
  for (const t of (teacherRows ?? [])) {
    teacherNameById[t.id] = (t.profiles as { full_name: string })?.full_name ?? ''
  }

  // 3. Названия курсов
  const courseIds = [...new Set((lessons as Lesson[]).map(l => l.course_id).filter(Boolean))] as string[]
  const { data: courseRows } = courseIds.length
    ? await supabase.from('courses').select('id, title').in('id', courseIds)
    : { data: [] }

  const courseTitleById: Record<string, string> = {}
  for (const c of (courseRows ?? [])) courseTitleById[c.id] = c.title

  // 4. Для групповых уроков — получаем студентов группы
  const groupIds = [...new Set((lessons as Lesson[]).filter(l => l.group_id).map(l => l.group_id!))]
  const groupStudentMap: Record<string, string[]> = {}

  if (groupIds.length > 0) {
    // group_students.student_id → students.profile_id
    const { data: gsRows } = await supabase
      .from('group_students')
      .select('group_id, student_id, students!inner(profile_id)')
      .in('group_id', groupIds)

    for (const row of (gsRows ?? [])) {
      const profileId = (row.students as { profile_id: string })?.profile_id
      if (!profileId) continue
      if (!groupStudentMap[row.group_id]) groupStudentMap[row.group_id] = []
      groupStudentMap[row.group_id].push(profileId)
    }
  }

  // 5. Для каждого занятия — создаём записи в очереди
  for (const lesson of (lessons as Lesson[])) {
    // Собираем получателей
    const recipients: string[] = []

    if (lesson.format === 'individual' && lesson.student_id) {
      recipients.push(lesson.student_id)
    } else if (lesson.group_id) {
      recipients.push(...(groupStudentMap[lesson.group_id] ?? []))
    }

    const teacherName = teacherNameById[lesson.teacher_id] ?? ''
    const courseTitle = lesson.course_id ? (courseTitleById[lesson.course_id] ?? '') : ''

    // Форматируем время в московском часовом поясе (UTC+3)
    const scheduledDate = new Date(lesson.scheduled_at)
    const moscowTime = scheduledDate.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day:    '2-digit',
      month:  '2-digit',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    })
    const moscowHHMM = scheduledDate.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      hour:   '2-digit',
      minute: '2-digit',
    })

    for (const profileId of recipients) {
      stats.recipients_checked++

      // Проверяем Telegram подключение
      if (!tgActive.has(profileId)) continue

      // Проверяем настройку уведомлений
      if (!lessonPrefOn.has(profileId)) continue

      const dedupKey = `lesson_reminder:${lesson.id}:${profileId}:${windowLabel}`

      const payload: Record<string, unknown> = {
        lesson_id:    lesson.id,
        title:        lesson.title,
        scheduled_at: moscowTime,
        time_hhmm:    moscowHHMM,
        course_title: courseTitle || undefined,
        teacher_name: teacherName || undefined,
        reminder_type: windowLabel,
      }
      if (lesson.zoom_link) payload.zoom_link = lesson.zoom_link

      const { error: insErr } = await supabase
        .from('notification_queue')
        .insert({
          profile_id:        profileId,
          channel:           'telegram',
          event_type:        'lesson_reminder',
          entity_type:       'lesson',
          entity_id:         lesson.id,
          deduplication_key: dedupKey,
          payload,
          status:            'pending',
          attempts:          0,
        })

      if (insErr) {
        if (insErr.code === '23505') {
          stats.duplicates_skipped++
        } else {
          console.error(`lesson-reminder-scheduler insert error [${windowLabel}]:`, insErr.message)
          stats.errors++
        }
      } else {
        if (windowLabel === '24h') stats.queued_24h++
        else stats.queued_1h++
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Fail-closed: без CRON_SECRET функция не запускается
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    console.error('lesson-reminder-scheduler: CRON_SECRET not configured')
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), { status: 500 })
  }
  const got = req.headers.get('X-Cron-Secret') ?? ''
  if (!safeEqual(got, cronSecret)) {
    console.warn('lesson-reminder-scheduler: rejected (bad or missing X-Cron-Secret)')
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Предзагружаем активные Telegram-подключения
  const { data: tgRows } = await supabase
    .from('telegram_connections')
    .select('profile_id')
    .eq('is_enabled', true)
    .is('disconnected_at', null)

  const tgActive = new Set<string>((tgRows ?? []).map(r => r.profile_id))

  // Предзагружаем настройки уведомлений (telegram=true, lesson=true или NULL=default true)
  const { data: prefRows } = await supabase
    .from('notification_prefs')
    .select('user_id, telegram, lesson')
    .eq('telegram', true)

  const lessonPrefOn = new Set<string>(
    (prefRows ?? [])
      .filter(r => r.lesson !== false) // null или true = включено
      .map(r => r.user_id)
  )

  const now = Date.now()

  // Окно 24 часа: [23:55 .. 24:05]
  const w24Start = new Date(now + (23 * 60 + 55) * 60 * 1000).toISOString()
  const w24End   = new Date(now + (24 * 60 + 5)  * 60 * 1000).toISOString()

  // Окно 1 час: [0:55 .. 1:05]
  const w1hStart = new Date(now + 55 * 60 * 1000).toISOString()
  const w1hEnd   = new Date(now + 65 * 60 * 1000).toISOString()

  const stats: Stats = {
    lessons_checked: 0,
    recipients_checked: 0,
    queued_24h: 0,
    queued_1h: 0,
    duplicates_skipped: 0,
    errors: 0,
  }

  await processWindow(supabase, '24h', w24Start, w24End, tgActive, lessonPrefOn, stats)
  await processWindow(supabase, '1h',  w1hStart, w1hEnd,  tgActive, lessonPrefOn, stats)

  console.log('lesson-reminder-scheduler:', JSON.stringify(stats))
  return new Response(JSON.stringify({ ok: true, ...stats }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
