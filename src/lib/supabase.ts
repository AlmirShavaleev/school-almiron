import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { timedFetch } from '@/lib/perf/rum'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

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
