// Edge Function: demo-impersonate
// Безопасный impersonation демо-пользователей (admin/owner → демо teacher/student).
// Возвращает одноразовый magic-link токен (БЕЗ пароля). Цель должна быть в demo_users.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(o: unknown, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const { data: { user: caller }, error: cErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
    if (cErr || !caller) return json({ error: 'Unauthorized' }, 401)
    const { data: cp } = await admin.from('profiles').select('role').eq('id', caller.id).single()
    if (!cp || !['admin', 'owner'].includes(cp.role)) return json({ error: 'Forbidden: только для admin/owner' }, 403)

    const { user_id } = await req.json()
    if (!user_id) return json({ error: 'user_id required' }, 400)
    if (user_id === caller.id) return json({ error: 'Это ваш собственный аккаунт' }, 400)

    // Исторически функция пускала только к демо-аккаунтам; 2026-08-02 открыта
    // для настоящих учителей, кураторов и учеников — владельцу нужно видеть
    // школу их глазами, когда «не видно» или «не работает» только у них.
    // Граница, которую держит сервер: войти под admin/owner НЕЛЬЗЯ, даже
    // другим админом, — имперсонация не должна давать чужие админские права.
    const { data: du } = await admin.from('demo_users').select('user_id, label').eq('user_id', user_id).maybeSingle()
    let label: string
    if (du) {
      label = du.label
    } else {
      const { data: tp } = await admin.from('profiles').select('full_name, role').eq('id', user_id).single()
      if (!tp) return json({ error: 'Пользователь не найден' }, 404)
      if (['admin', 'owner'].includes(tp.role)) {
        return json({ error: 'Входить под администратором нельзя' }, 403)
      }
      const roleLabel = tp.role === 'teacher' ? 'учитель' : tp.role === 'curator' ? 'куратор' : 'ученик'
      label = `${tp.full_name ?? 'Без имени'} (${roleLabel})`
    }

    const { data: tu } = await admin.auth.admin.getUserById(user_id)
    const email = tu?.user?.email
    if (!email) return json({ error: 'Пользователь не найден' }, 404)

    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (lErr || !link?.properties?.hashed_token) return json({ error: lErr?.message || 'link error' }, 400)

    // Аудит: логи edge-функций хранятся в Supabase — по ним виден каждый вход.
    console.log(JSON.stringify({ impersonate: user_id, by: caller.id, at: new Date().toISOString() }))

    return json({ email, token_hash: link.properties.hashed_token, label })
  } catch (e) {
    return json({ error: (e as Error).message || 'error' }, 500)
  }
})
