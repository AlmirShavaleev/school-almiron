import { supabase } from '@/lib/supabase'

/**
 * Обращения к edge-функциям привязки. Ничего нового: те же
 * `generate-telegram-link`, `disconnect-telegram`, `send-telegram-test`,
 * что уже звала страница настроек.
 *
 * Вынесено в одно место, потому что теперь вызывающих двое — настройки и
 * приглашение при входе. Две копии `fetch` с ручной сборкой заголовков
 * разъезжаются молча: в проекте это уже стоило двух багов (§49 — событие под
 * двумя именами, §65 — склейка заголовка в трёх копиях).
 */
async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type':  'application/json',
  }
}

function fnUrl(name: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`
}

/** Ссылка-приглашение в бота. Одноразовый токен собирает сервер. */
export async function requestTelegramLink(): Promise<string> {
  const res  = await fetch(fnUrl('generate-telegram-link'), {
    method: 'POST', headers: await authHeaders(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? 'Не удалось создать ссылку')
  return body.link as string
}

export async function disconnectTelegram(): Promise<void> {
  const res = await fetch(fnUrl('disconnect-telegram'), {
    method: 'POST', headers: await authHeaders(),
  })
  if (!res.ok) throw new Error('Не удалось отключить Telegram')
}

/**
 * Пробное сообщение. Нужен не «тест ради теста»: после привязки человек должен
 * увидеть, что канал живой, — иначе он не знает, сработало ли.
 *
 * Сбой глушим у вызывающего: привязка уже состоялась, и ронять из-за
 * необязательного письма нечего.
 */
export async function sendTelegramTest(): Promise<void> {
  const res = await fetch(fnUrl('send-telegram-test'), {
    method: 'POST', headers: await authHeaders(),
  })
  if (!res.ok) throw new Error('Не удалось отправить пробное сообщение')
}

/**
 * Привязан ли Telegram у самого пользователя.
 *
 * Своя строка доступна по политике `tc_select_own` (`profile_id = auth.uid()`),
 * definer-обвязка не нужна. Отсутствие строки — это `null`, а не ошибка:
 * `maybeSingle` именно для этого.
 */
export async function fetchOwnTelegramLinked(profileId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('telegram_connections')
    .select('telegram_chat_id, is_enabled, disconnected_at')
    .eq('profile_id', profileId)
    .maybeSingle()

  if (error) throw error
  if (!data) return false
  return Boolean(data.telegram_chat_id) && data.is_enabled !== false && data.disconnected_at === null
}
