/**
 * Edge Function: disconnect-telegram
 * Отключает Telegram для текущего авторизованного пользователя.
 * Обновляет telegram_connections и notification_prefs.
 *
 * ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
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

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const profileId = user.id

    // Находим подключение
    const { data: conn } = await supabase
      .from('telegram_connections')
      .select('telegram_chat_id')
      .eq('profile_id', profileId)
      .single()

    // Обновляем: помечаем как отключённый
    await supabase
      .from('telegram_connections')
      .update({
        is_enabled:      false,
        disconnected_at: new Date().toISOString(),
      })
      .eq('profile_id', profileId)

    // Отключаем telegram в настройках
    await supabase
      .from('notification_prefs')
      .upsert({ user_id: profileId, telegram: false }, { onConflict: 'user_id' })

    // Уведомляем пользователя в Telegram (если возможно)
    if (conn?.telegram_chat_id) {
      const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
      if (botToken) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            chat_id:    conn.telegram_chat_id,
            text:       '🔕 Telegram-уведомления отключены. Ты можешь снова подключить их в настройках профиля на платформе.',
            parse_mode: 'HTML',
          }),
        }).catch(() => { /* игнорируем ошибки доставки */ })
      }
    }

    return json({ ok: true })
  } catch (e) {
    console.error('disconnect-telegram error:', e instanceof Error ? e.message : 'unknown')
    return err('Internal server error', 500)
  }
})
