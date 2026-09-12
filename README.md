# Школа Almiron — EdTech платформа

Полноценная онлайн-платформа для подготовки к ЕГЭ/ОГЭ по физике и математике с ролевой системой, личными кабинетами, CRM и геймификацией.

## Технологический стек
- **Frontend**: React 18 + Vite + TypeScript
- **UI**: Tailwind CSS v3 + Lucide Icons + Recharts
- **Backend/BaaS**: Supabase (PostgreSQL + Auth + RLS)
- **State**: Zustand + React Hook Form + Zod

## Быстрый старт

### 1. Установка
npm install

### 2. Настройка окружения
cp .env.example .env
# Заполните VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY

### 3. Запуск
npm run dev

> Без Supabase: работает в demo-режиме. Демо-учётки заводятся локально скриптом `scripts/seed-users.mjs` — пароли не хранятся в репозитории.

## Настройка Supabase
Применить миграции в SQL Editor:
1. supabase/migrations/001_schema.sql
2. supabase/migrations/002_rls.sql
3. supabase/migrations/003_seed.sql

## Роли
| Роль | Путь | Описание |
|------|------|----------|
| student | /student | ДЗ, занятия, рейтинг, достижения |
| parent | /parent | Прогресс детей, платежи |
| teacher | /teacher | Группы, ДЗ, посещаемость |
| curator | /curator | Мониторинг, зона риска |
| admin | /admin | Управление платформой |
| owner | /owner | Бизнес-аналитика |

## Демо-аккаунты

Заводятся локально скриптом `scripts/seed-users.mjs` (см. §160 в
`PROJECT_STATE.md`). Пароль не хранится в репозитории — передаётся
скрипту через переменную окружения `SEED_PASSWORD`. Скрипт отказывается
работать против боевого проекта Supabase.
