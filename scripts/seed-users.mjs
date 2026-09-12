// Seed script — creates demo users via Supabase Admin API
// Run: SEED_PASSWORD=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/seed-users.mjs
//
// §160: раньше здесь был захардкожен и боевой SUPABASE_URL, и пароль
// в открытом виде — ровно так демо-аккаунты и оказались в боевой
// базе с общим паролем из репозитория. Теперь оба значения обязаны прийти
// извне, а скрипт прямо отказывается работать против боевого проекта.

import { createClient } from '@supabase/supabase-js'

// Постоянный идентификатор боевого проекта (ref из его URL) — единственный
// надёжный признак прода, не завязанный на то, как назвали переменную окружения.
const PRODUCTION_PROJECT_REF = 'kthfozyfruorwjhvvsbw'

const SUPABASE_URL = process.env.SUPABASE_URL
const SEED_PASSWORD = process.env.SEED_PASSWORD
// Нужен SERVICE ROLE KEY (не anon!) — найдите в Supabase → Settings → API → service_role
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL) {
  console.error('SUPABASE_URL не задан. Укажите адрес ЛОКАЛЬНОГО или тестового проекта Supabase.')
  process.exit(1)
}
if (SUPABASE_URL.includes(PRODUCTION_PROJECT_REF)) {
  console.error(`Отказ: SUPABASE_URL указывает на боевой проект (${PRODUCTION_PROJECT_REF}). Этот скрипт заводит демо-пользователей только в локальной/тестовой базе.`)
  process.exit(1)
}
if (!SEED_PASSWORD) {
  console.error('SEED_PASSWORD не задан. Пароль демо-пользователей больше не хранится в коде — передайте его переменной окружения.')
  process.exit(1)
}
if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_KEY не задан.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const users = [
  // Ученики
  { email: 'alex@demo.ru',            full_name: 'Алексей Петров',     role: 'student', id: 'aa000001-0000-0000-0000-000000000000' },
  { email: 'maria@demo.ru',           full_name: 'Мария Иванова',       role: 'student', id: 'aa000002-0000-0000-0000-000000000000' },
  { email: 'dima@demo.ru',            full_name: 'Дмитрий Козлов',     role: 'student', id: 'aa000003-0000-0000-0000-000000000000' },
  { email: 'anna@demo.ru',            full_name: 'Анна Сидорова',       role: 'student', id: 'aa000004-0000-0000-0000-000000000000' },
  { email: 'ivan@demo.ru',            full_name: 'Иван Новиков',        role: 'student', id: 'aa000005-0000-0000-0000-000000000000' },
  { email: 'sofia@demo.ru',           full_name: 'София Морозова',      role: 'student', id: 'aa000006-0000-0000-0000-000000000000' },
  { email: 'nikita@demo.ru',          full_name: 'Никита Волков',       role: 'student', id: 'aa000007-0000-0000-0000-000000000000' },
  { email: 'kate@demo.ru',            full_name: 'Екатерина Лебедева', role: 'student', id: 'aa000008-0000-0000-0000-000000000000' },
  { email: 'pavel@demo.ru',           full_name: 'Павел Зайцев',        role: 'student', id: 'aa000009-0000-0000-0000-000000000000' },
  { email: 'olga@demo.ru',            full_name: 'Ольга Семёнова',      role: 'student', id: 'aa000010-0000-0000-0000-000000000000' },
  // Родители
  { email: 'petrov-parent@demo.ru',   full_name: 'Сергей Петров',       role: 'parent',  id: 'bb000001-0000-0000-0000-000000000000' },
  { email: 'ivanova-parent@demo.ru',  full_name: 'Елена Иванова',       role: 'parent',  id: 'bb000002-0000-0000-0000-000000000000' },
  { email: 'kozlov-parent@demo.ru',   full_name: 'Андрей Козлов',       role: 'parent',  id: 'bb000003-0000-0000-0000-000000000000' },
  // Преподаватели
  { email: 'physics@demo.ru',         full_name: 'Виктор Андреев',      role: 'teacher', id: 'cc000001-0000-0000-0000-000000000000' },
  { email: 'math@demo.ru',            full_name: 'Наталья Фёдорова',   role: 'teacher', id: 'cc000002-0000-0000-0000-000000000000' },
  // Куратор
  { email: 'curator@demo.ru',         full_name: 'Светлана Кириллова', role: 'curator', id: 'dd000001-0000-0000-0000-000000000000' },
  // Админ
  { email: 'admin@demo.ru',           full_name: 'Администратор',       role: 'admin',   id: 'ee000001-0000-0000-0000-000000000000' },
  // Владелец (демо)
  { email: 'owner@demo.ru',           full_name: 'Алмирон Ректор',      role: 'owner',   id: 'ff000001-0000-0000-0000-000000000000' },
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
      password: SEED_PASSWORD,
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
