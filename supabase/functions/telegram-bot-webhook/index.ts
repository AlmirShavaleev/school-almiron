/**
 * Edge Function: telegram-bot-webhook
 * Принимает webhook-события от Telegram Bot API.
 * Обрабатывает команду /start TOKEN для привязки аккаунта.
 *
 * Безопасность:
 * - Не доверяет данным клиента
 * - Проверяет токен через hash
 * - Повторный /start не создаёт дубликат
 * - Не возвращает секреты
 * - anon-доступ (Telegram не шлёт Authorization)
 *
 * ENV: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Установка webhook:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *        -H "Content-Type: application/json" \
 *        -d '{"url":"https://<project>.supabase.co/functions/v1/telegram-bot-webhook"}'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TG_API = 'https://api.telegram.org'

/**
 * ⚠️ ВРЕМЕННЫЙ ТЕСТОВЫЙ РЕЖИМ (см. PROJECT_STATE.md §41).
 *
 * true  — один Telegram-аккаунт можно привязать к нескольким профилям сразу.
 *         Нужно владельцу: аккаунт в Telegram у него один, а проверять надо
 *         все роли (ученик / преподаватель / куратор / админ).
 * false — прод-поведение: один Telegram = один профиль.
 *
 * Перед выкладкой на реальных учеников вернуть в false И вернуть
 * UNIQUE (telegram_chat_id) миграцией — сама по себе константа базу не чинит.
 * Порядок отката описан в §41.
 */
const ALLOW_MULTI_PROFILE_LINK = true

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from: { id: number; username?: string; first_name: string }
    chat: { id: number; type: string }
    text?: string
    date: number
  }
}

async function sendTelegramMessage(chatId: number, text: string, token: string) {
  await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
}

async function hashToken(token: string): Promise<string> {
  const encoder    = new TextEncoder()
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Constant-time сравнение строк (защита от timing-атак на secret header) */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let res = 0
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return res === 0
}

Deno.serve(async (req: Request) => {
  // Telegram не шлёт CORS preflight
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // ── Проверка секретного заголовка Telegram (fail-closed) ────────────────
  // Telegram присылает значение из setWebhook(secret_token) в этом заголовке.
  const expectedSecret = Deno.env.get('TELEGRAM_WEBHOOK_SECRET')
  const gotSecret      = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
  if (!expectedSecret || !safeEqual(gotSecret, expectedSecret)) {
    // Не логируем значения секретов/заголовка
    console.warn('telegram-bot-webhook: rejected request (bad or missing secret header)')
    return new Response('Unauthorized', { status: 401 })
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured')
    return new Response('ok') // не раскрываем ошибку
  }

  let update: TelegramUpdate
  try {
    update = await req.json()
  } catch {
    return new Response('ok')
  }

  const message = update.message
  if (!message?.text) return new Response('ok')

  const chatId   = message.chat.id
  const text     = message.text.trim()
  const username = message.from.username
  const name     = message.from.first_name

  // Обрабатываем только /start
  if (!text.startsWith('/start')) {
    await sendTelegramMessage(chatId,
      '👋 Привет! Чтобы подключить уведомления, перейди в настройки платформы Almiron и нажми «Подключить Telegram».',
      botToken,
    )
    return new Response('ok')
  }

  const parts = text.split(/\s+/)
  const rawToken = parts[1]?.trim()

  if (!rawToken) {
    await sendTelegramMessage(chatId,
      '⚠️ Ссылка недействительна. Получи новую в настройках профиля на платформе.',
      botToken,
    )
    return new Response('ok')
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const tokenHash = await hashToken(rawToken)

    // ── 1. Проверяем токен ───────────────────────────────────────────────
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('telegram_link_tokens')
      .select('id, profile_id, expires_at, used_at')
      .eq('token_hash', tokenHash)
      .single()

    if (tokenErr || !tokenRow) {
      await sendTelegramMessage(chatId,
        '❌ Ссылка недействительна или устарела. Запроси новую в настройках профиля.',
        botToken,
      )
      return new Response('ok')
    }

    if (tokenRow.used_at) {
      await sendTelegramMessage(chatId,
        '⚠️ Эта ссылка уже была использована. Запроси новую в настройках профиля.',
        botToken,
      )
      return new Response('ok')
    }

    if (new Date(tokenRow.expires_at) < new Date()) {
      await sendTelegramMessage(chatId,
        '⏰ Ссылка истекла (срок действия 15 минут). Запроси новую в настройках профиля.',
        botToken,
      )
      return new Response('ok')
    }

    const profileId = tokenRow.profile_id

    // ── 2. Проверяем, не занят ли уже этот chat_id ──────────────────────
    // ВРЕМЕННО отключаемо (§41): в тестовом режиме один Telegram разрешено
    // держать на нескольких профилях, поэтому проверку занятости пропускаем.
    if (!ALLOW_MULTI_PROFILE_LINK) {
      // .limit(1) вместо .single(): если в базе уже накопились дубли chat_id
      // (наследие тестового режима), .single() падал бы с ошибкой вместо
      // осмысленного ответа пользователю.
      const { data: takenByOther } = await supabase
        .from('telegram_connections')
        .select('id, profile_id')
        .eq('telegram_chat_id', chatId)
        .neq('profile_id', profileId)
        .limit(1)

      if (takenByOther && takenByOther.length > 0) {
        await sendTelegramMessage(chatId,
          '⚠️ Этот Telegram уже привязан к другому аккаунту. Обратись в поддержку.',
          botToken,
        )
        return new Response('ok')
      }
    }

    // ── 3. Upsert подключения ────────────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from('telegram_connections')
      .upsert({
        profile_id:       profileId,
        telegram_chat_id: chatId,
        telegram_username: username ?? null,
        is_enabled:       true,
        connected_at:     new Date().toISOString(),
        disconnected_at:  null,
      }, { onConflict: 'profile_id' })

    if (upsertErr) throw upsertErr

    // ── 4. Помечаем токен использованным ────────────────────────────────
    await supabase
      .from('telegram_link_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', tokenRow.id)

    // ── 5. Обновляем is_enabled в notification_prefs ────────────────────
    await supabase
      .from('notification_prefs')
      .upsert({ user_id: profileId, telegram: true }, { onConflict: 'user_id' })

    // ── 6. Подтверждаем пользователю ────────────────────────────────────
    const greeting = username ? `@${username}` : name

    // В тестовом режиме в один чат сыплются уведомления сразу нескольких
    // профилей, поэтому подписываем, какой именно аккаунт сейчас подключён,
    // иначе разобрать, от чьего лица пришло сообщение, невозможно.
    let accountLine = ''
    if (ALLOW_MULTI_PROFILE_LINK) {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', profileId)
        .maybeSingle()

      if (profileRow) {
        accountLine = `\n\n🧪 Тестовый режим. Подключён аккаунт: <b>${profileRow.full_name ?? '—'}</b> (${profileRow.role ?? '—'}).\nОдин Telegram сейчас можно держать на нескольких аккаунтах.`
      }
    }

    await sendTelegramMessage(chatId,
      `✅ <b>Telegram подключён!</b>\n\nПривет, ${greeting}!\nТеперь ты будешь получать уведомления о занятиях, домашних заданиях и их проверке прямо здесь.\n\nНастроить уведомления можно в разделе «Настройки» на платформе.${accountLine}`,
      botToken,
    )

  } catch (e) {
    // Логируем только сообщение об ошибке, без update/PII/секретов
    console.error('telegram-bot-webhook error:', e instanceof Error ? e.message : 'unknown')
    // Не раскрываем детали ошибки пользователю
    await sendTelegramMessage(chatId,
      '⚠️ Произошла ошибка. Пожалуйста, попробуй ещё раз или обратись в поддержку.',
      botToken,
    )
  }

  return new Response('ok')
})
