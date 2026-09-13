/**
 * Адреса видео Bunny — вход для клиента.
 *
 * Сам разбор живёт в `supabase/functions/_shared/bunnyVideoUrl.ts`: его же
 * использует edge-функция статистики `bunny-video-stats` (§146), а при
 * деплое она видит только `supabase/functions/`. Вторую копию регулярки
 * на клиенте не заводим — разъехавшийся разбор означал бы, что форма
 * сохраняет одно, а статистика считает другое (§168).
 */
export {
  BUNNY_DEFAULT_LIBRARY_ID,
  bunnyEmbedUrl,
  normalizeBunnyVideoUrl,
  parseBunnyVideoUrl,
  type BunnyVideoRef,
} from '../../supabase/functions/_shared/bunnyVideoUrl.ts'
