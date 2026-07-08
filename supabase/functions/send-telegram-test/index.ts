/**
 * Edge Function: send-telegram-test
 * Отправляет тестовое сообщение в Telegram текущему авторизованному пользователю.
 * Используется для проверки подключения (Фаза 1).
 *
 * Прямая отправка (без очереди) — очередь и worker относятся к Фазе 2.
 *
 * Безопасность:
 * - verify_jwt на gateway + getUser()
 * - bot token только в secrets, не возвращается клиенту
 * - не логирует token и chat_id
 *
 * ENV: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const corsOk = () => new Response('ok', { headers: corsHeaders })
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
const err = (message: string, status = 400) => json({ error: message }, status)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsOk()
  if (req.method !== 'POST') return err('Method Not Allowed', 405)

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('Unauthorized', 401)

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return err('Unauthorized', 401)

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    if (!botToken) {
      console.error('TELEGRAM_BOT_TOKEN not configured')
      return err('Bot not configured', 500)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Берём активное подключение пользователя
    const { data: conn } = await supabase
      .from('telegram_connections')
      .select('telegram_chat_id, is_enabled, disconnected_at')
      .eq('profile_id', user.id)
      .is('disconnected_at', null)
      .maybeSingle()

    if (!conn || !conn.is_enabled || !conn.telegram_chat_id) {
      return err('Telegram not connected', 409)
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    conn.telegram_chat_id,
        text:       '🔔 <b>Тестовое сообщение</b>\n\nЕсли ты это видишь — Telegram-уведомления School Almiron работают. 🎉',
        parse_mode: 'HTML',
      }),
    })

    if (!tgRes.ok) {
      const body = await tgRes.json().catch(() => ({}))
      // Не логируем token; описание ошибки Telegram безопасно
      console.error('send-telegram-test: Telegram API error', tgRes.status, body?.description ?? '')
      return err('Failed to deliver test message', 502)
    }

    return json({ ok: true })
  } catch (e) {
    console.error('send-telegram-test error:', e instanceof Error ? e.message : 'unknown')
    return err('Internal server error', 500)
  }
})
