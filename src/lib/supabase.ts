import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { timedFetch } from '@/lib/perf/rum'

// ВРЕМЕННО (авария self-hosted, ноябрь 2026): сайт смотрит в старый облачный
// проект School, а не в переменные Vercel. Ключ anon публичный — он и так
// уходит в браузер. Чтобы вернуться на свой сервер, убрать CLOUD_FALLBACK
// и читать снова только import.meta.env. См. src/lib/readOnlyMode.ts.
const CLOUD_FALLBACK = {
  url: 'https://kthfozyfruorwjhvvsbw.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt0aGZvenlmcnVvcndqaHZ2c2J3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MjYzNjQsImV4cCI6MjA5NjUwMjM2NH0.P6SiNXfezXnKqyYWhHL-hUSMQDEtSTOP7A3Ev6tfeLY',
}

const supabaseUrl = CLOUD_FALLBACK.url
const supabaseAnonKey = CLOUD_FALLBACK.anonKey

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not set. Using demo mode.')
}

export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  // §291: длительность каждого запроса — в RUM (только путь, метод, статус, мс)
  { global: { fetch: timedFetch((input, init) => fetch(input, init)) } },
)

export const SUPABASE_URL = supabaseUrl || 'https://placeholder.supabase.co'
export const SUPABASE_ANON_KEY = supabaseAnonKey || 'placeholder-key'
