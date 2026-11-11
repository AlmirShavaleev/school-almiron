// ВРЕМЕННО (авария self-hosted, ноябрь 2026): адрес облачного проекта School, куда сейчас
// смотрит сайт. Отдельным модулем без клиента Supabase, чтобы его можно было брать там,
// где `@/lib/supabase` подменяется в тестах (рисунки каталога, `catalogContent.ts`).
export const CLOUD_SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'
