-- ============================================================
-- SEED DATA — Demo Users & Content
-- NOTE: Run this AFTER creating users via Supabase Auth dashboard
-- or use the seed script in /scripts/seed.ts
-- ============================================================

-- Achievements
insert into achievements (title, description, icon, xp_reward, condition_type, condition_value) values
  ('Первое ДЗ', 'Сдал первое домашнее задание', '📝', 50, 'homework', 1),
  ('Отличник', 'Набрал 90+ баллов за ДЗ', '⭐', 100, 'score', 90),
  ('Посещаемость 100%', '10 занятий без пропусков', '✅', 150, 'attendance', 10),
  ('Пробник сдан', 'Прошёл первый пробный экзамен', '📋', 100, 'exam', 1),
  ('Серия 5', 'Сдал 5 ДЗ подряд', '🔥', 200, 'streak', 5),
  ('Серия 10', 'Сдал 10 ДЗ подряд', '💥', 400, 'streak', 10),
  ('Топ-3 рейтинга', 'Вошёл в топ-3 класса', '🏆', 300, 'score', 95),
  ('Пробник 80+', 'Набрал 80+ на пробнике', '🎯', 250, 'exam', 80),
  ('Суперзнаток', 'Прошёл 20 тем', '🧠', 500, 'attendance', 20),
  ('Легенда', 'Набрал 5000 XP', '👑', 1000, 'score', 100);

-- Demo data is inserted via the TypeScript seed script
-- See /scripts/seed.ts for full demo data setup
select 'Achievements seeded' as status;
