/**
 * Edge Function: generate-telegram-link
 * Создаёт одноразовую ссылку для подключения Telegram.
 * Доступно только авторизованным пользователям.
 *
 * ENV: TELEGRAM_BOT_USERNAME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sha256Hex, TOKEN_TTL_MS } from '../_shared/telegramLinkToken.ts'

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

  try {
    // ── 1. Проверяем авторизацию ──────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('Unauthorized', 401)

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser()
    if (authError || !user) return err('Unauthorized', 401)

    const profileId = user.id

    // ── 2. Генерируем одноразовый токен ──────────────────────────────────
    const tokenBytes = new Uint8Array(32)
    crypto.getRandomValues(tokenBytes)
    const token = btoa(String.fromCharCode(...tokenBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const tokenHash = await sha256Hex(token)

    // ── 3. Сохраняем токен через service role ────────────────────────────
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Прежние живые токены этого профиля больше не нужны — убираем их перед
    // выдачей нового, иначе повторное нажатие кнопки плодит мусорные строки.
    await supabaseAdmin
      .from('telegram_link_tokens')
      .delete()
      .eq('profile_id', profileId)
      .is('used_at', null)

    const { error: insertError } = await supabaseAdmin
      .from('telegram_link_tokens')
      .insert({
        profile_id: profileId,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
      })

    if (insertError) throw insertError

    const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME')
    if (!botUsername) throw new Error('TELEGRAM_BOT_USERNAME not set')

    const link = `https://t.me/${botUsername}?start=${token}`

    return json({ link })

  } catch (e) {
    console.error('generate-telegram-link error:', e instanceof Error ? e.message : 'unknown')
    return err('Internal server error', 500)
  }
})
