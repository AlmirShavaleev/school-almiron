import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildLinkButton,
  buildVariantAssignedTelegramMessage,
  buildVariantDeadlineTelegramMessage,
  classifyTelegramError,
  escapeHtml,
  isTelegramPreferenceEnabled,
} from '../_shared/variant-telegram.ts'

const TG_API    = 'https://api.telegram.org'
const MAX_RETRY = 3

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

interface QueueItem {
  id:                string
  profile_id:        string
  event_type:        string
  payload:           Record<string, unknown>
  attempts:          number
}

function buildMessage(item: QueueItem, appUrl: string) {
  const p = item.payload
  const esc = escapeHtml

  // Ссылку во всех карточках отдаём одинаково — кнопкой под сообщением.
  // Почему кнопка, а не `<a href>` в тексте — см. buildLinkButton в
  // `_shared/variant-telegram.ts`: битый href Telegram глотает молча.
  const button = (link: unknown, label: string) => {
    const raw    = typeof link === 'string' && link ? link : null
    const markup = buildLinkButton(raw, appUrl, label)
    if (raw && !markup) {
      console.warn(
        `process-notification-queue: кнопка не собрана (event=${item.event_type}). ` +
        `APP_URL пуст, localhost или не абсолютный — сообщение уйдёт без ссылки.`,
      )
    }
    return markup
  }

  switch (item.event_type) {
    case 'new_homework':
      return {
        text: (
        `📚 <b>Новое домашнее задание</b>\n\n` +
        (p.course_title ? `Курс: ${esc(p.course_title)}\n` : '') +
        `Тема: ${esc(p.title)}\n` +
        `Дедлайн: ${esc(p.due_date)}`
        ),
        // p.link — новый контур (страница темы); entity_id — легаси-фолбэк
        replyMarkup: button(
          p.link ?? (p.entity_id ? `/homeworks/${String(p.entity_id)}` : null),
          'Открыть задание',
        ),
      }

    // ── Новый контур ДЗ (topic_homework) ──────────────────────────────────

    case 'topic_homework_submitted':
      return {
        text: (
        `📥 <b>Ученик сдал домашнее задание</b>\n\n` +
        `${esc(p.student_name ?? 'Ученик')}` +
        (Number(p.attempt_number) > 1 ? ` (попытка №${esc(p.attempt_number)})` : '') + `\n` +
        (p.course_title ? `Курс: ${esc(p.course_title)}\n` : '') +
        `Тема: ${esc(p.title)}`
        ),
        replyMarkup: button(p.link, 'Проверить работу'),
      }

    case 'topic_homework_reviewed': {
      const accepted = p.decision === 'accepted'
      const comment  = typeof p.comment === 'string' && p.comment.trim()
        ? (p.comment.length > 300 ? p.comment.slice(0, 300) + '…' : p.comment)
        : null
      return {
        text: (
        `📝 <b>Домашнее задание проверено</b>\n\n` +
        (p.course_title ? `Курс: ${esc(p.course_title)}\n` : '') +
        `Тема: ${esc(p.title)}\n` +
        `Статус: ${accepted ? '✅ Принято' : '🔄 На доработку'}` +
        (accepted && p.score != null && p.max_score != null ? `\nОценка: ${esc(p.score)} из ${esc(p.max_score)}` : '') +
        (comment ? `\nКомментарий: ${esc(comment)}` : '')
        ),
        replyMarkup: button(p.link, 'Открыть тему'),
      }
    }

    case 'lesson_reminder': {
      const is24h = p.reminder_type === '24h'
      const time  = esc(p.time_hhmm ?? p.scheduled_at ?? '')
      const course = p.course_title ? `Курс: ${esc(p.course_title)}\n` : ''
      const teacher = p.teacher_name ? `Преподаватель: ${esc(p.teacher_name)}\n` : ''
      // zoom_link — внешний абсолютный URL, appUrl к нему не приклеивается
      const markup = button(p.zoom_link, 'Ссылка на занятие')

      if (is24h) {
        return {
          text: (
          `📅 <b>Напоминание о занятии</b>\n\n` +
          `Завтра в ${time} состоится занятие\n` +
          course +
          `Тема: ${esc(p.title ?? 'Занятие')}\n` +
          teacher
          ),
          replyMarkup: markup,
        }
      }
      return {
        text: (
        `⏰ <b>Занятие через час</b>\n\n` +
        `Начало в ${time}\n` +
        course +
        `Тема: ${esc(p.title ?? 'Занятие')}\n` +
        teacher
        ),
        replyMarkup: markup,
      }
    }

    case 'lesson_rescheduled':
      return {
        text: (
        `🔄 <b>Занятие перенесено</b>\n\n` +
        `Тема: ${esc(p.title ?? 'Занятие')}\n` +
        `Было: ${esc(p.old_scheduled_at)}\n` +
        `Стало: ${esc(p.new_scheduled_at)}`
        ),
        replyMarkup: null,
      }

    case 'lesson_cancelled':
      return {
        text: (
        `❌ <b>Занятие отменено</b>\n\n` +
        `Тема: ${esc(p.title ?? 'Занятие')}\n` +
        `Дата: ${esc(p.scheduled_at)}\n` +
        (p.group_name ? `Группа: ${esc(p.group_name)}` : '')
        ),
        replyMarkup: null,
      }

    case 'homework_reviewed': {
      const statusLabel = p.status === 'checked' ? '✅ Принято' : '🔄 На доработку'
      return {
        text: (
        `📝 <b>Домашнее задание проверено</b>\n\n` +
        `Тема: ${esc(p.title)}\n` +
        `Статус: ${statusLabel}\n` +
        (p.score != null ? `Баллы: ${esc(p.score)}/${esc(p.max_score)}\n` : '') +
        (p.feedback ? `Комментарий: ${esc(p.feedback)}` : '')
        ),
        replyMarkup: null,
      }
    }

    case 'collection_assigned':
      return {
        text: `📚 <b>Новое домашнее задание</b>\n\n«${esc(p.title ?? 'Без названия')}»` +
          (p.due_at ? `\nДедлайн: ${esc(p.due_at)}` : '\nБез дедлайна'),
        replyMarkup: button(p.link, 'Открыть ДЗ'),
      }

    case 'collection_submitted':
    case 'collection_resubmitted':
      return {
        text: `${item.event_type === 'collection_resubmitted' ? '🔄 <b>Повторная сдача ДЗ</b>' : '📥 <b>Новая сдача ДЗ</b>'}\n\n` +
          `${esc(p.student_name ?? 'Ученик')} ${item.event_type === 'collection_resubmitted' ? 'повторно сдал' : 'сдал'} «${esc(p.title ?? 'Без названия')}»`,
        replyMarkup: button(p.link, 'Проверить работу'),
      }

    case 'collection_reviewed': {
      const statusLabel = p.status === 'accepted'
        ? '✅ Принято'
        : p.status === 'returned'
          ? '🔄 Возвращено на доработку'
          : '❌ Отклонено'
      return {
        text: `📝 <b>Домашнее задание проверено</b>\n\n«${esc(p.title ?? 'Без названия')}»\nСтатус: ${statusLabel}` +
          (p.score != null ? `\nБалл: ${esc(p.score)}` : '') +
          (p.comment ? `\nКомментарий: ${esc(p.comment)}` : ''),
        replyMarkup: button(p.link, 'Открыть ДЗ'),
      }
    }

    // Итог варианта. `finalize_grading` кладёт эту строку каналом telegram
    // (§53); до этого был 'in_app', и доезжала она только потому, что claim не
    // фильтровал канал.
    case 'variant_graded':
      return {
        text: (
        `📊 <b>${esc(p.title ?? 'Работа проверена')}</b>\n\n` +
        `${esc(p.body ?? '')}`
        ),
        replyMarkup: button(p.link, 'Открыть работу'),
      }

    case 'variant_assigned': {
      const { text, replyMarkup } = buildVariantAssignedTelegramMessage({
        title: typeof p.title === 'string' ? p.title : undefined,
        subject: typeof p.subject === 'string' ? p.subject : null,
        exam_type: typeof p.exam_type === 'string' ? p.exam_type : null,
        group_name: typeof p.group_name === 'string' ? p.group_name : null,
        tasks_count: typeof p.tasks_count === 'number' ? p.tasks_count : null,
        due_at: typeof p.due_at === 'string' ? p.due_at : null,
        available_from: typeof p.available_from === 'string' ? p.available_from : null,
        link: typeof p.link === 'string' ? p.link : null,
        button_text: typeof p.button_text === 'string' ? p.button_text : null,
      }, appUrl)
      return { text, replyMarkup }
    }

    case 'variant_deadline_changed': {
      const { text, replyMarkup } = buildVariantDeadlineTelegramMessage({
        title: typeof p.title === 'string' ? p.title : undefined,
        due_at: typeof p.due_at === 'string' ? p.due_at : null,
        link: typeof p.link === 'string' ? p.link : null,
        button_text: typeof p.button_text === 'string' ? p.button_text : null,
      }, appUrl)
      return { text, replyMarkup }
    }

    default:
      return {
        text: `📬 Новое уведомление: ${esc(p.title ?? item.event_type)}`,
        replyMarkup: button(p.link, 'Открыть'),
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
    console.error('process-notification-queue: CRON_SECRET not configured')
    return new Response(JSON.stringify({ error: 'CRON_SECRET not configured' }), { status: 500 })
  }
  const got = req.headers.get('X-Cron-Secret') ?? ''
  if (!safeEqual(got, cronSecret)) {
    console.warn('process-notification-queue: rejected (bad or missing X-Cron-Secret)')
    return new Response('Unauthorized', { status: 401 })
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const appUrl   = Deno.env.get('APP_URL') ?? ''

  if (!botToken) {
    console.error('process-notification-queue: TELEGRAM_BOT_TOKEN not configured')
    return new Response(JSON.stringify({ error: 'Bot token not configured' }), { status: 500 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Атомарно захватываем пачку (claim также восстанавливает зависшие processing > 10 мин)
  const { data: items, error: claimErr } = await supabase
    .rpc('claim_notification_queue', { batch_size: 20 })

  if (claimErr) {
    console.error('claim_notification_queue error:', claimErr.message)
    return new Response(JSON.stringify({ error: 'Queue claim failed' }), { status: 500 })
  }

  const results = { sent: 0, failed: 0, skipped: 0 }

  for (const item of (items ?? []) as QueueItem[]) {
    try {
      // Проверяем активное Telegram-подключение
      const { data: conn } = await supabase
        .from('telegram_connections')
        .select('telegram_chat_id, is_enabled')
        .eq('profile_id', item.profile_id)
        .is('disconnected_at', null)
        .maybeSingle()

      if (!conn?.is_enabled || !conn.telegram_chat_id) {
        await supabase
          .from('notification_queue')
          .update({ status: 'cancelled' })
          .eq('id', item.id)
        results.skipped++
        continue
      }

      // Проверяем настройки уведомлений
      const { data: prefs } = await supabase
        .from('notification_prefs')
        .select('telegram, homework, lesson, checked, lesson_changed, telegram_variant_assignments')
        .eq('user_id', item.profile_id)
        .maybeSingle()

      const prefEnabled = isTelegramPreferenceEnabled(item.event_type, prefs)

      if (!prefEnabled) {
        await supabase
          .from('notification_queue')
          .update({ status: 'cancelled' })
          .eq('id', item.id)
        results.skipped++
        continue
      }

      // Отправляем в Telegram
      const message = buildMessage(item, appUrl)
      const tgRes = await fetch(`${TG_API}/bot${botToken}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:                  conn.telegram_chat_id,
          text:                     message.text,
          parse_mode:               'HTML',
          disable_web_page_preview: true,
          reply_markup:             message.replyMarkup ?? undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (tgRes.ok) {
        await supabase
          .from('notification_queue')
          .update({
            status:   'sent',
            sent_at:  new Date().toISOString(),
            attempts: item.attempts + 1,
          })
          .eq('id', item.id)
        results.sent++
        continue
      }

      // Обрабатываем ошибку Telegram
      const tgBody    = await tgRes.json().catch(() => ({}))
      const tgDesc    = (tgBody as { description?: string }).description ?? 'unknown'
      const errInfo   = classifyTelegramError(tgRes.status, tgDesc)
      const newAttempts = item.attempts + 1

      if (errInfo.isBotBlocked) {
        // Отключаем Telegram-подключение пользователя
        await supabase
          .from('telegram_connections')
          .update({
            is_enabled:        false,
            disconnected_at:   new Date().toISOString(),
            disconnect_reason: `Bot blocked: ${tgDesc.substring(0, 200)}`,
          })
          .eq('profile_id', item.profile_id)
          .is('disconnected_at', null)

        await supabase
          .from('notification_prefs')
          .update({ telegram: false })
          .eq('user_id', item.profile_id)

        await supabase
          .from('notification_queue')
          .update({
            status:     'failed',
            attempts:   newAttempts,
            last_error: `Bot blocked by user`,
          })
          .eq('id', item.id)

        console.warn(`process-notification-queue: bot blocked for profile, connection disabled`)
        results.failed++
        continue
      }

      if (errInfo.isPermanent) {
        // Постоянная ошибка — не повторяем
        await supabase
          .from('notification_queue')
          .update({
            status:     'failed',
            attempts:   newAttempts,
            last_error: errInfo.safeMessage,
          })
          .eq('id', item.id)
        results.failed++
        continue
      }

      // Временная ошибка (429, 5xx, network) — retry если < MAX_RETRY
      const isFinal = newAttempts >= MAX_RETRY
      await supabase
        .from('notification_queue')
        .update({
          status:       isFinal ? 'failed' : 'pending',
          attempts:     newAttempts,
          last_error:   errInfo.safeMessage,
          // Для 429 откладываем на retry_after секунд если доступно
          ...(tgRes.status === 429 && tgBody.parameters?.retry_after
            ? { scheduled_for: new Date(Date.now() + (tgBody.parameters.retry_after as number) * 1000).toISOString() }
            : {}),
        })
        .eq('id', item.id)
      results.failed++

    } catch (e) {
      // Сетевой сбой / timeout — временная ошибка
      const errMsg      = e instanceof Error ? e.message : 'network error'
      const newAttempts = item.attempts + 1
      const isFinal     = newAttempts >= MAX_RETRY

      await supabase
        .from('notification_queue')
        .update({
          status:     isFinal ? 'failed' : 'pending',
          attempts:   newAttempts,
          last_error: `Network: ${errMsg.substring(0, 200)}`,
        })
        .eq('id', item.id)

      console.error('process-notification-queue: network error:', errMsg)
      results.failed++
    }
  }

  console.log('process-notification-queue results:', JSON.stringify(results))
  return new Response(JSON.stringify({ ok: true, ...results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
