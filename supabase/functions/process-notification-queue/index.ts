import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  buildLinkButton,
  buildVariantAssignedTelegramMessage,
  buildVariantDeadlineTelegramMessage,
  classifyTelegramError,
  escapeHtml,
  formatDay,
  formatWhen,
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

/**
 * Скриншоты к обращению. Бакет приватный, поэтому ссылки подписываются прямо
 * перед отправкой и живут десять минут: Telegram успевает скачать файл сам, а
 * долгоживущая ссылка на чужой скриншот никому не нужна. Хранить подписанные
 * ссылки в payload нельзя по той же причине.
 *
 * Сбой здесь не трогает статус строки: текст обращения уже доставлен, и терять
 * его из-за картинки хуже, чем прислать письмо без вложения.
 */
async function sendSupportAttachments(
  supabase: { storage: { from: (b: string) => { createSignedUrls: (paths: string[], expiresIn: number) => Promise<{ data: Array<{ signedUrl: string | null }> | null; error: unknown }> } } },
  botToken: string,
  chatId:   string,
  payload:  Record<string, unknown>,
) {
  const paths = Array.isArray(payload.attachments)
    ? (payload.attachments as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
    : []
  if (paths.length === 0) return

  const { data, error } = await supabase.storage
    .from('support-attachments')
    .createSignedUrls(paths, 600)

  if (error || !data) {
    console.warn('process-notification-queue: не удалось подписать ссылки на скриншоты обращения')
    return
  }

  const urls = data.map(d => d.signedUrl).filter((u): u is string => typeof u === 'string' && u.length > 0)
  if (urls.length === 0) return

  const single = urls.length === 1
  const res = await fetch(`${TG_API}/bot${botToken}/${single ? 'sendPhoto' : 'sendMediaGroup'}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(single
      ? { chat_id: chatId, photo: urls[0] }
      : { chat_id: chatId, media: urls.map(u => ({ type: 'photo', media: u })) }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    console.warn('process-notification-queue: скриншоты обращения не ушли:',
      res.status, (body as { description?: string }).description ?? '')
  }
}

function buildMessage(item: QueueItem, appUrl: string) {
  const p = item.payload
  const esc = escapeHtml

  // Курс и тема — одной строкой через «·» (сквозное решение, утверждено
  // 2026-08-03). Пустой курс не должен оставлять висящий разделитель.
  const headline = (course: string, subject: string) =>
    [course, subject].filter(s => s && s.length > 0).join(' · ')

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
    // Тексты ниже утверждены владельцем 2026-08-03 целиком
    // (ТЕКСТЫ_ТГ_КАРТОЧЕК.md). Сквозные решения: не обращаемся к читателю,
    // курс и тема — одной строкой через «·», исход в заголовке, на кнопке
    // глагол действия, даты по-русски.

    case 'new_homework':
      return {
        text: (
        `📚 <b>Новое домашнее задание</b>\n\n` +
        `${headline(esc(p.course_title), esc(p.title))}\n` +
        // due_date приходит датой без времени (ISO) либо null
        (p.due_date ? `Сдать до ${esc(formatDay(p.due_date))}` : 'Без дедлайна')
        ),
        // p.link — новый контур (страница темы); entity_id — легаси-фолбэк
        replyMarkup: button(
          p.link ?? (p.entity_id ? `/homeworks/${String(p.entity_id)}` : null),
          'Открыть задание',
        ),
      }

    // Приветствие при добавлении в курс. Ссылок на ДЗ и списка заданий здесь
    // намеренно нет — решение владельца: рассылка по старым ДЗ была бы спамом.
    case 'course_enrolled':
      return {
        text: (
        `🎓 <b>Ты добавлен в курс «${esc(p.course_title ?? 'Курс')}»</b>` +
        (p.teacher_name ? `\n\nПреподаватель: ${esc(p.teacher_name)}` : '')
        ),
        replyMarkup: button(
          p.link,
          typeof p.button_text === 'string' && p.button_text ? p.button_text : 'Открыть курс',
        ),
      }

    // Зачисление глазами преподавателя. Вторая ветка того же триггера, что и
    // `course_enrolled`, но со своим ключом дедупликации и своим получателем.
    //
    // Почты ученика здесь нет и быть не должно: Telegram — канал вне нашего
    // контроля, персоналу хватает имени и курса. Почта уходит только в
    // карточку внутри приложения.
    case 'course_student_enrolled':
      return {
        text: (
        `👤 <b>Новый ученик в курсе</b>\n\n` +
        `${esc(p.student_name ?? 'Имя не заполнено')}\n` +
        headline(esc(p.course_title), esc(p.group_name))
        ),
        replyMarkup: button(
          p.link,
          typeof p.button_text === 'string' && p.button_text ? p.button_text : 'Открыть ученика',
        ),
      }

    // ── Новый контур ДЗ (topic_homework) ──────────────────────────────────

    case 'topic_homework_submitted': {
      const retry = Number(p.attempt_number) > 1
      return {
        text: (
        `📥 <b>Работа на проверку</b>\n\n` +
        `${esc(p.student_name ?? 'Ученик')}` +
        (retry ? ` · пересдача (попытка ${esc(p.attempt_number)})` : '') + `\n` +
        headline(esc(p.course_title), esc(p.title))
        ),
        replyMarkup: button(p.link, 'Проверить работу'),
      }
    }

    case 'topic_homework_reviewed': {
      const accepted = p.decision === 'accepted'
      const comment  = typeof p.comment === 'string' && p.comment.trim()
        ? (p.comment.length > 300 ? p.comment.slice(0, 300) + '…' : p.comment)
        : null
      const scored = accepted && p.score != null && p.max_score != null
      return {
        text: (
        (accepted
          ? `✅ <b>Работа принята${scored ? ` — ${esc(p.score)} из ${esc(p.max_score)}` : ''}</b>`
          : `🔄 <b>Работа на доработку</b>`) + `\n\n` +
        headline(esc(p.course_title), esc(p.title)) +
        (comment ? `\n\n${esc(comment)}` : '')
        ),
        replyMarkup: button(p.link, 'Посмотреть разбор'),
      }
    }

    case 'lesson_reminder': {
      const is24h = p.reminder_type === '24h'
      const time  = esc(p.time_hhmm ?? p.scheduled_at ?? '')
      // zoom_link — внешний абсолютный URL, appUrl к нему не приклеивается
      const markup = button(p.zoom_link, 'Подключиться')

      if (is24h) {
        return {
          text: (
          `📅 <b>Завтра в ${time} — занятие</b>\n\n` +
          headline(esc(p.course_title), esc(p.title ?? 'Занятие')) +
          (p.teacher_name ? `\nПреподаватель: ${esc(p.teacher_name)}` : '')
          ),
          replyMarkup: markup,
        }
      }
      // За час имя преподавателя уже ничего не решает — время и кнопка.
      return {
        text: (
        `⏰ <b>Занятие через час, в ${time}</b>\n\n` +
        headline(esc(p.course_title), esc(p.title ?? 'Занятие'))
        ),
        replyMarkup: markup,
      }
    }

    case 'lesson_rescheduled':
      return {
        text: (
        `🔄 <b>Занятие перенесено</b>\n\n` +
        `${esc(p.title ?? 'Занятие')}\n` +
        `<s>${esc(formatWhen(p.old_scheduled_at))}</s> → <b>${esc(formatWhen(p.new_scheduled_at))}</b>`
        ),
        replyMarkup: null,
      }

    case 'lesson_cancelled':
      return {
        text: (
        `❌ <b>Занятие отменено</b>\n\n` +
        `${esc(p.title ?? 'Занятие')}\n` +
        `${esc(formatWhen(p.scheduled_at))}` +
        (p.group_name ? ` · ${esc(p.group_name)}` : '')
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

    // «Сборник», а не «домашнее задание»: заголовок слово в слово совпадал с
    // new_homework, и в списке чатов два разных события выглядели одинаково.
    case 'collection_assigned':
      return {
        text: `📚 <b>Новый сборник задач</b>\n\n«${esc(p.title ?? 'Без названия')}»` +
          (p.due_at ? `\nСдать до ${esc(formatWhen(p.due_at))}` : '\nБез дедлайна'),
        replyMarkup: button(p.link, 'Открыть сборник'),
      }

    case 'collection_submitted':
    case 'collection_resubmitted':
      return {
        text: `${item.event_type === 'collection_resubmitted' ? '🔄 <b>Пересдача на проверку</b>' : '📥 <b>Работа на проверку</b>'}\n\n` +
          `${esc(p.student_name ?? 'Ученик')} · «${esc(p.title ?? 'Без названия')}»`,
        replyMarkup: button(p.link, 'Проверить работу'),
      }

    case 'collection_reviewed': {
      const accepted = p.status === 'accepted'
      const head = accepted
        ? `✅ <b>Сборник принят${p.score != null ? ` — ${esc(p.score)} баллов` : ''}</b>`
        : p.status === 'returned'
          ? `🔄 <b>Сборник на доработку</b>`
          : `❌ <b>Сборник отклонён</b>`
      return {
        text: `${head}\n\n«${esc(p.title ?? 'Без названия')}»` +
          (p.comment ? `\n\n${esc(p.comment)}` : ''),
        replyMarkup: button(p.link, 'Открыть сборник'),
      }
    }

    // Ветки `variant_graded` здесь нет: карточка о проверке тестирования
    // убрана решением владельца 04.08 вместе с производителем в
    // `finalize_grading`. `variant_assigned` (выдача варианта) остаётся.

    // Обращение «Сообщить о проблеме» — админам и владельцу. Текст целиком
    // приходит из строки support_requests, здесь только оформление.
    case 'support_request': {
      const shots = Array.isArray(p.attachments) ? p.attachments.length : 0
      // Заголовок постоянный, тема пользователя — строкой ниже. Раньше тема
      // стояла заголовком, и карточка «🛠 ыфвыф» не сообщала, что это вообще
      // такое: тему пишет человек в спешке, полагаться на неё как на название
      // события нельзя.
      const subject = typeof p.subject === 'string' && p.subject.trim() ? p.subject.trim() : null
      return {
        text: (
        `🛠 <b>Сообщение о проблеме</b>\n\n` +
        (subject ? `${esc(subject)}\n` : '') +
        `${esc(p.author_name ?? 'Пользователь')} · ${esc(p.author_role ?? '—')}\n` +
        (p.page_path ? `Страница: ${esc(p.page_path)}\n` : '') +
        (p.created_at ? `${esc(p.created_at)}\n` : '') +
        `\n${esc(p.message ?? '')}` +
        (shots > 0 ? `\n\n📎 Скриншотов: ${shots}` : '')
        ),
        // Ссылки пока нет: страницы истории обращений в интерфейсе тоже нет.
        // Появится — придёт в payload, кнопка соберётся сама.
        replyMarkup: button(p.link, 'Открыть обращение'),
      }
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
        if (item.event_type === 'support_request') {
          await sendSupportAttachments(supabase, botToken, String(conn.telegram_chat_id), item.payload)
        }
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
