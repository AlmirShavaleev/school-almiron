import { supabase } from './supabase'

const ADMIN_KEY = 'demo-admin-session'
const IMP_KEY   = 'demo-impersonating'

function notify() { window.dispatchEvent(new Event('demo:change')) }

/** Входит как демо-пользователь (impersonation через одноразовый magic-link токен). */
export async function impersonate(userId: string, label: string): Promise<void> {
  // 1. сохранить текущую (админскую) сессию для возврата
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Нет активной сессии')
  sessionStorage.setItem(ADMIN_KEY, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  }))

  // 2. серверная проверка (admin/owner + демо-юзер) → токен без пароля
  const { data, error } = await supabase.functions.invoke('demo-impersonate', { body: { user_id: userId } })
  if (error) { sessionStorage.removeItem(ADMIN_KEY); throw error }
  if (data?.error) { sessionStorage.removeItem(ADMIN_KEY); throw new Error(data.error) }

  // 3. стать целевым пользователем
  const { error: vErr } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash, type: 'magiclink',
  })
  if (vErr) { sessionStorage.removeItem(ADMIN_KEY); throw vErr }

  sessionStorage.setItem(IMP_KEY, label)
  notify()
}

/** Возврат в аккаунт администратора (восстановление сохранённой сессии). */
export async function returnToAdmin(): Promise<void> {
  const raw = sessionStorage.getItem(ADMIN_KEY)
  if (!raw) return
  const { access_token, refresh_token } = JSON.parse(raw)
  await supabase.auth.setSession({ access_token, refresh_token })
  sessionStorage.removeItem(ADMIN_KEY)
  sessionStorage.removeItem(IMP_KEY)
  notify()
}

export function impersonatingLabel(): string | null {
  return sessionStorage.getItem(IMP_KEY)
}
