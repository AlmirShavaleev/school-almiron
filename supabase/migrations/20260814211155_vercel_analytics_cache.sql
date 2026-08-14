-- Кэш ответа Vercel Web Analytics для вкладки «Сайт» в панели админа.
--
-- Почему таблица, а не память edge-функции: инстансы поднимаются и гаснут и
-- память между собой не делят — кэш в памяти давал бы попадание через раз, а
-- мимо попадания идёт внешний запрос со своей задержкой и лимитом. Таблица
-- общая для всех инстансов.
--
-- Ровно ОДНА строка: панель одна, разрезов по параметрам нет. Ключ-константа
-- с check (id = 1) — тогда «обновить кэш» это upsert, а не пара «удалить и
-- вставить», между которыми таблица пуста и параллельный вызов уходит в
-- Vercel зря.
--
-- Что здесь НЕ лежит: сырые адреса посещений. Только агрегаты, которые вернул
-- Vercel (решение владельца: топы и разбивки, не журнал переходов).
--
-- Доступа нет ни у кого: RLS без единой политики, гранты сняты. Пишет и
-- читает только edge-функция под service-ключом, а она сама сначала проверяет,
-- что вызывающий — админ.

create table if not exists public.vercel_analytics_cache (
  id         smallint primary key default 1 check (id = 1),
  payload    jsonb       not null,
  fetched_at timestamptz not null default now()
);

comment on table public.vercel_analytics_cache is
  'Единственная строка с последним ответом Vercel Web Analytics. Пишет '
  'edge-функция vercel-analytics под service-ключом; свежесть проверяет она '
  'же по fetched_at. Сырых адресов посещений здесь нет — только агрегаты.';

alter table public.vercel_analytics_cache enable row level security;
revoke all on table public.vercel_analytics_cache from anon, authenticated;
