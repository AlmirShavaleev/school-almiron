/**
 * Edge Function: create-user
 * Создаёт нового пользователя (учителя/куратора/студента/admin) от имени администратора.
 * Использует service role для создания auth-аккаунта без потери сессии вызывающего.
 *
 * Доступно только для ролей: admin, owner
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface CreateUserRequest {
  email:     string
  password:  string
  full_name: string
  role:      'teacher' | 'curator' | 'student' | 'parent' | 'admin'
}

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Проверяем авторизацию вызывающего ───────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Supabase admin client (service role)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify caller token
    const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check caller is admin or owner
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (!callerProfile || !['admin', 'owner'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: только для администраторов' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 2. Парсим запрос ───────────────────────────────────────────────
    const body: CreateUserRequest = await req.json()
    const { email, password, full_name, role } = body

    if (!email || !password || !full_name || !role) {
      return new Response(JSON.stringify({ error: 'Заполните все поля' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (password.length < 6) {
      return new Response(JSON.stringify({ error: 'Пароль минимум 6 символов' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 3. Создаём auth-пользователя (без email-подтверждения) ─────────
    const { data: newUserData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,  // Пропускаем подтверждение email
      user_metadata: { full_name },
    })

    if (createError) {
      return new Response(JSON.stringify({ error: createError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = newUserData.user.id

    // ── 4. Создаём профиль (триггер создаст teachers/curators/students) ─
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({ id: newUserId, email, full_name, role })

    if (profileError) {
      // Откатываем: удаляем auth-пользователя
      await supabaseAdmin.auth.admin.deleteUser(newUserId)
      return new Response(JSON.stringify({ error: profileError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── 5. Возвращаем созданного пользователя ──────────────────────────
    return new Response(JSON.stringify({
      user: {
        id:        newUserId,
        email,
        full_name,
        role,
      }
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Внутренняя ошибка' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
