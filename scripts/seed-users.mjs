// Seed script — creates demo users via Supabase Admin API
// Run: node scripts/seed-users.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kthfozyfruorwjhvvsbw.supabase.co'

// Нужен SERVICE ROLE KEY (не anon!) — найдите в Supabase → Settings → API → service_role
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const users = [
  // Ученики
  { email: 'alex@demo.ru',            password: 'demo123', full_name: 'Алексей Петров',     role: 'student', id: 'aa000001-0000-0000-0000-000000000000' },
  { email: 'maria@demo.ru',           password: 'demo123', full_name: 'Мария Иванова',       role: 'student', id: 'aa000002-0000-0000-0000-000000000000' },
  { email: 'dima@demo.ru',            password: 'demo123', full_name: 'Дмитрий Козлов',     role: 'student', id: 'aa000003-0000-0000-0000-000000000000' },
  { email: 'anna@demo.ru',            password: 'demo123', full_name: 'Анна Сидорова',       role: 'student', id: 'aa000004-0000-0000-0000-000000000000' },
  { email: 'ivan@demo.ru',            password: 'demo123', full_name: 'Иван Новиков',        role: 'student', id: 'aa000005-0000-0000-0000-000000000000' },
  { email: 'sofia@demo.ru',           password: 'demo123', full_name: 'София Морозова',      role: 'student', id: 'aa000006-0000-0000-0000-000000000000' },
  { email: 'nikita@demo.ru',          password: 'demo123', full_name: 'Никита Волков',       role: 'student', id: 'aa000007-0000-0000-0000-000000000000' },
  { email: 'kate@demo.ru',            password: 'demo123', full_name: 'Екатерина Лебедева', role: 'student', id: 'aa000008-0000-0000-0000-000000000000' },
  { email: 'pavel@demo.ru',           password: 'demo123', full_name: 'Павел Зайцев',        role: 'student', id: 'aa000009-0000-0000-0000-000000000000' },
  { email: 'olga@demo.ru',            password: 'demo123', full_name: 'Ольга Семёнова',      role: 'student', id: 'aa000010-0000-0000-0000-000000000000' },
  // Родители
  { email: 'petrov-parent@demo.ru',   password: 'demo123', full_name: 'Сергей Петров',       role: 'parent',  id: 'bb000001-0000-0000-0000-000000000000' },
  { email: 'ivanova-parent@demo.ru',  password: 'demo123', full_name: 'Елена Иванова',       role: 'parent',  id: 'bb000002-0000-0000-0000-000000000000' },
  { email: 'kozlov-parent@demo.ru',   password: 'demo123', full_name: 'Андрей Козлов',       role: 'parent',  id: 'bb000003-0000-0000-0000-000000000000' },
  // Преподаватели
  { email: 'physics@demo.ru',         password: 'demo123', full_name: 'Виктор Андреев',      role: 'teacher', id: 'cc000001-0000-0000-0000-000000000000' },
  { email: 'math@demo.ru',            password: 'demo123', full_name: 'Наталья Фёдорова',   role: 'teacher', id: 'cc000002-0000-0000-0000-000000000000' },
  // Куратор
  { email: 'curator@demo.ru',         password: 'demo123', full_name: 'Светлана Кириллова', role: 'curator', id: 'dd000001-0000-0000-0000-000000000000' },
  // Админ
  { email: 'admin@demo.ru',           password: 'demo123', full_name: 'Администратор',       role: 'admin',   id: 'ee000001-0000-0000-0000-000000000000' },
  // Владелец (демо)
  { email: 'owner@demo.ru',           password: 'demo123', full_name: 'Алмирон Ректор',      role: 'owner',   id: 'ff000001-0000-0000-0000-000000000000' },
]

async function seed() {
  console.log('🚀 Создаём демо-пользователей...\n')

  // Сначала удаляем старые записи (если есть)
  for (const u of users) {
    const { data: existing } = await supabase.auth.admin.listUsers()
    const found = existing?.users?.find(eu => eu.email === u.email)
    if (found) {
      await supabase.auth.admin.deleteUser(found.id)
      console.log(`🗑  Удалён старый: ${u.email}`)
    }
  }

  // Создаём заново
  for (const u of users) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
    })

    if (error) {
      console.error(`❌ Ошибка ${u.email}:`, error.message)
      continue
    }

    const userId = data.user.id
    console.log(`✅ Создан: ${u.email} (${userId})`)

    // Upsert профиль с нужным role
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: userId, email: u.email, full_name: u.full_name, role: u.role })

    if (profileError) {
      console.error(`   ⚠️  Профиль: ${profileError.message}`)
    } else {
      console.log(`   👤 Профиль создан: ${u.role}`)
    }
  }

  console.log('\n✨ Готово!')
}

seed().catch(console.error)
