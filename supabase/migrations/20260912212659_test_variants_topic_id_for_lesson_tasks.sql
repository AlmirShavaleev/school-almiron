-- Вариант-носитель задач к уроку.
--
-- До сих пор ответить на вопрос «в каком варианте лежат задачи ЭТОЙ темы» было
-- нечем: связь жила только в выдаче (`test_variant_assignments`), а выдачи может
-- не быть вовсе — у скопированного из шаблона курса, у темы, которую ещё никто
-- не открывал. Теперь носитель помечен самой темой, а выдача остаётся выдачей.
--
-- Один вариант на тему: частичный уникальный индекс. Двух наборов задач к одному
-- уроку не бывает, а если бы завелись — их было бы нечем различить на экране.

alter table public.test_variants
  add column if not exists topic_id uuid references public.topics(id) on delete set null;

comment on column public.test_variants.topic_id is
  'Тема курса, задачи к уроку которой несёт этот вариант. NULL — обычный вариант из раздела «Тесты». §164';

create unique index if not exists test_variants_topic_id_key
  on public.test_variants (topic_id)
  where topic_id is not null;

-- Что уже привязано к темам — помечаем носителем. Берём только однозначное:
-- вариант привязан ровно к одной теме и у темы ровно один вариант. Спорные
-- случаи (их на проде нет: тем с привязкой ноль) остаются без пометки, и
-- прикрепление из каталога заведёт для такой темы свой набор.
update public.test_variants v
   set topic_id = pick.topic_id
  from (
    select a.variant_id, (array_agg(distinct a.topic_id))[1] as topic_id
      from public.test_variant_assignments a
     where a.topic_id is not null
     group by a.variant_id
    having count(distinct a.topic_id) = 1
  ) pick
 where pick.variant_id = v.id
   and v.topic_id is null
   and not exists (
     select 1 from public.test_variant_assignments a2
      where a2.topic_id = pick.topic_id
        and a2.variant_id <> pick.variant_id
   );

-- Ленивая выдача создаёт строку ученика при первом обращении к задачам темы.
-- Две вкладки, открытые разом, — обычное дело: без этого индекса гонка положила
-- бы две строки выдачи одному ученику, и его ответы разъехались бы по двум.
create unique index if not exists test_variant_student_assignments_one_per_student
  on public.test_variant_student_assignments (assignment_id, student_id);
