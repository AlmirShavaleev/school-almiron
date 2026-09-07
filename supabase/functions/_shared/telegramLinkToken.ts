/**
 * Криптопримитивы для одноразовых токенов привязки Telegram.
 *
 * Токен — не случайные байты, а HMAC-SHA256(SUPABASE_SERVICE_ROLE_KEY, id),
 * base64url. Это осознанный выбор ради повторного нажатия кнопки: если у
 * профиля уже есть живой (неиспользованный, непросроченный) токен, нужно
 * вернуть ТОТ ЖЕ токен, а таблица хранит только token_hash — план "переделать
 * таблицы" запрещён, поэтому восстановить сохранённый когда-то случайный
 * токен нечем. HMAC от стабильного id строки решает это без новых колонок:
 * зная id существующей строки, тот же токен пересчитывается детерминированно
 * и его SHA-256 совпадёт с уже сохранённым token_hash — вебхук бота хэширует
 * пришедшую от Telegram строку тем же plain SHA-256 и ищет по нему, так что
 * его код (telegram-bot-webhook) не тронут и не должен быть в курсе этой схемы.
 *
 * Используется и в generate-telegram-link (Deno), и в тестах (Vitest/Node) —
 * оба рантайма дают Web Crypto (`crypto.subtle`) глобально, поэтому файл не
 * зависит от Deno-специфичных API.
 */

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** Детерминированный токен из id строки — тот же id всегда даёт тот же токен. */
export async function deriveToken(secret: string, tokenId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(tokenId))
  return toBase64Url(new Uint8Array(signature))
}

/** Plain SHA-256 (не HMAC) — ровно то, что вебхук считает от присланной строки. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Час вместо пятнадцати минут — единственное место, где живёт этот срок. */
export const TOKEN_TTL_MS = 60 * 60 * 1000
