-- Кэш ответов Bunny Stream для вкладки «Видео» в панели админа.
--
-- Почему таблица, а не память edge-функции: инстансы поднимаются и гаснут и
-- память между собой не делят — кэш в памяти давал бы попадание через раз, а
-- мимо попадания идёт внешний запрос со своей задержкой и лимитом. Тот же
-- довод, что у vercel_analytics_cache (§135).
--
-- Почему НЕ одна строка с check (id = 1), как там: здесь разрезов честно два,
-- и живут они с разной свежестью.
--   'library'          — снимок всей библиотеки: числа по каждому видео плюс
--                        итоги за период. Один на всех, обновляется целиком.
--   'heatmap:<guid>'   — тепловая карта одного видео. Забирается по клику, а
--                        не пачкой: карт 127, а смотрят их по одной.
-- Свежесть проверяет функция по fetched_at, разную для этих двух видов.
--
-- Что здесь НЕ лежит:
--   • связка видео → тема → курс. Она дешёвая и берётся из своих таблиц на
--     каждый запрос — иначе переименованная тема висела бы старым именем до
--     конца срока кэша, а таблица перестала бы быть честным снимком Bunny;
--   • что-либо о зрителях. Bunny его и не отдаёт: ссылки у нас без токенов,
--     для него все зрители безымянные (решение владельца при импорте видео).
--
-- Доступа нет ни у кого: RLS без единой политики, гранты сняты. Пишет и
-- читает только edge-функция bunny-video-stats под service-ключом, а она
-- сама сначала проверяет, что вызывающий — админ или владелец.

create table if not exists public.bunny_video_stats_cache (
  cache_key  text        primary key
    constraint bunny_video_stats_cache_key_chk
    check (cache_key = 'library' or cache_key like 'heatmap:%'),
  payload    jsonb       not null,
  fetched_at timestamptz not null default now()
);

comment on table public.bunny_video_stats_cache is
  'Снимки ответов Bunny Stream. Ключ ''library'' — числа по всем видео '
  'библиотеки и итоги за период; ''heatmap:<guid>'' — тепловая карта одного '
  'видео. Пишет edge-функция bunny-video-stats под service-ключом, свежесть '
  'проверяет она же по fetched_at. Сведений о зрителях здесь нет — Bunny их '
  'не отдаёт.';

comment on column public.bunny_video_stats_cache.fetched_at is
  'Когда ответ забран из Bunny. Показывается на экране подписью «данные на».';

alter table public.bunny_video_stats_cache enable row level security;
revoke all on table public.bunny_video_stats_cache from anon, authenticated;
