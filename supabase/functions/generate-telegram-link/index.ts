/**
 * Edge Function: generate-telegram-link
 * Создаёт одноразовую ссылку для подключения Telegram.
 * Доступно только авторизованным пользователям.
 *
 * ENV: TELEGRAM_BOT_USERNAME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { deriveToken, sha256Hex, TOKEN_TTL_MS } from '../_shared/telegramLinkToken.ts'

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

    // ── 2. Ищем уже живой (неиспользованный, непросроченный) токен ───────
    // Повторное нажатие кнопки не должно плодить новый токен — иначе первая
    // открытая ссылка тихо становится нерабочей, а в таблице копится мусор.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: existing, error: selectError } = await supabaseAdmin
      .from('telegram_link_tokens')
      .select('id')
      .eq('profile_id', profileId)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (selectError) throw selectError

    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const tokenId = existing?.id ?? crypto.randomUUID()

    // ── 3. Если живого токена не было — заводим новую строку ─────────────
    // Токен — не случайные байты, а HMAC(secret, id): при повторном заходе
    // сюда с тем же id пересчитывается тот же токен, хотя хранится только
    // его хэш (см. _shared/telegramLinkToken.ts).
    if (!existing) {
      const token     = await deriveToken(secret, tokenId)
      const tokenHash = await sha256Hex(token)

      // Старые неиспользованные токены этого профиля больше не нужны.
      await supabaseAdmin
        .from('telegram_link_tokens')
        .delete()
        .eq('profile_id', profileId)
        .is('used_at', null)

      const { error: insertError } = await supabaseAdmin
        .from('telegram_link_tokens')
        .insert({
          id:         tokenId,
          profile_id: profileId,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
        })
      if (insertError) throw insertError
    }

    const token = await deriveToken(secret, tokenId)

    const botUsername = Deno.env.get('TELEGRAM_BOT_USERNAME')
    if (!botUsername) throw new Error('TELEGRAM_BOT_USERNAME not set')

    const link = `https://t.me/${botUsername}?start=${token}`

    return json({ link })

  } catch (e) {
    console.error('generate-telegram-link error:', e instanceof Error ? e.message : 'unknown')
    return err('Internal server error', 500)
  }
})
