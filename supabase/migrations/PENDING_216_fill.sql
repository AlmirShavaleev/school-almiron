-- §216. РАЗОВОЕ ЗАПОЛНЕНИЕ. Это ДАННЫЕ, а не схема.
--
-- Файл лежит рядом с миграциями, но миграцией НЕ является: он не создаёт
-- ничего и в schema_migrations не попадает. Прогоняет его оркестратор руками,
-- после того как посмотрел шаг А. Схему (колонку и разбор) кладёт
-- PENDING_216.sql — этот файл без неё не запустится.
--
-- Что делает: вытаскивает номера заданий ЕГЭ из НАЗВАНИЙ тем и кладёт их в
-- topics.ege_task_numbers. Названия не трогает вовсе — «№13 — Методы решения
-- тригонометрических уравнений» так и останется.
--
-- ИДЕМПОТЕНТНОСТЬ. Шаг Б трогает только темы с ПУСТЫМ ege_task_numbers.
-- Отсюда два свойства:
--   * повторный прогон не меняет ничего и не плодит дублей — у заполненных
--     тем массив уже не пуст;
--   * то, что владелец ввёл руками, заполнение НЕ перетирает. Это важнее
--     «пересчитать всё заново»: человек правит номера как раз там, где
--     название соврало.
-- Если когда-нибудь понадобится именно пересчёт — снимать условие
-- `ege_task_numbers = '{}'` осознанно и только после разговора с владельцем.
--
-- «Живой курс» здесь: `is_active and not is_draft and not is_template` — та
-- же выборка, на которой оркестратор 25.09 намерил 354 темы (188 математика,
-- 166 физика). Если у него в замере предикат был другой, шаг А это покажет
-- сразу: числа не сойдутся, и трогать базу до выяснения не надо.

-- ──────────────────────────────────────────────────────────────────────────
-- Шаг А. ПОСМОТРЕТЬ. Ничего не меняет.
-- ──────────────────────────────────────────────────────────────────────────
-- Сколько тем получит номера, отдельно по физике и математике, отдельно по
-- живым и остальным курсам. Ожидание по замеру 25.09: живые курсы —
-- 131 математика, 54 физика.
select
  case when c.subject = 'physics' then 'физика' else 'математика' end as предмет,
  case when c.is_active and not c.is_draft and not c.is_template
       then 'живой курс' else 'прочее (черновик/шаблон/архив)' end     as курс,
  count(*)                                                            as тем_всего,
  count(*) filter (where t.ege_task_numbers <> '{}')                  as уже_проставлено,
  count(*) filter (where t.ege_task_numbers = '{}'
                     and public.ege_numbers_from_title(t.title) <> '{}') as проставит_шаг_б,
  count(*) filter (where t.ege_task_numbers = '{}'
                     and public.ege_numbers_from_title(t.title) =  '{}') as номера_в_названии_нет
from public.topics t
join public.modules m on m.id = t.module_id
join public.courses c on c.id = m.course_id
group by 1, 2
order by 1, 2;

-- Построчно — что именно будет проставлено. Смотреть глазами до шага Б:
-- разбор идёт по тексту, который писали люди, и одно кривое название дешевле
-- увидеть здесь, чем потом в отчёте родителю.
select c.subject, c.title as курс, t.title as тема,
       public.ege_numbers_from_title(t.title) as номера
from public.topics t
join public.modules m on m.id = t.module_id
join public.courses c on c.id = m.course_id
where c.is_active and not c.is_draft and not c.is_template
  and t.ege_task_numbers = '{}'
  and public.ege_numbers_from_title(t.title) <> '{}'
order by c.subject, c.title, m.order_index, t.order_index;

-- ──────────────────────────────────────────────────────────────────────────
-- Шаг Б. ПРОСТАВИТЬ. Только живые курсы, только пустые темы.
-- ──────────────────────────────────────────────────────────────────────────
update public.topics t
   set ege_task_numbers = public.ege_numbers_from_title(t.title)
  from public.modules m, public.courses c
 where m.id = t.module_id
   and c.id = m.course_id
   and c.is_active and not c.is_draft and not c.is_template
   and t.ege_task_numbers = '{}'
   and public.ege_numbers_from_title(t.title) <> '{}';

-- Шаг Б2 — ТОЛЬКО ПО ОТДЕЛЬНОМУ РЕШЕНИЮ, поэтому закомментирован.
-- Те же номера в темах шаблонных, черновых и снятых курсов. Смысл есть:
-- копия курса берёт название темы у шаблона, и шаблон с пустыми номерами
-- раздаёт пустоту дальше. Но это уже не та выборка, которую мерил владелец,
-- и в отчёте §216 её числа не названы — поэтому решает он.
--
-- update public.topics t
--    set ege_task_numbers = public.ege_numbers_from_title(t.title)
--   from public.modules m, public.courses c
--  where m.id = t.module_id
--    and c.id = m.course_id
--    and not (c.is_active and not c.is_draft and not c.is_template)
--    and t.ege_task_numbers = '{}'
--    and public.ege_numbers_from_title(t.title) <> '{}';

-- ──────────────────────────────────────────────────────────────────────────
-- Шаг В. ПРОВЕРИТЬ. Тот же счёт, что в шаге А.
-- ──────────────────────────────────────────────────────────────────────────
-- После шага Б «проставит_шаг_б» обязано стать нулём по живым курсам, а
-- «уже_проставлено» — вырасти ровно на столько, сколько там стояло до него.
-- Второй прогон шага Б меняет 0 строк: это и есть проверка идемпотентности.
select
  case when c.subject = 'physics' then 'физика' else 'математика' end as предмет,
  case when c.is_active and not c.is_draft and not c.is_template
       then 'живой курс' else 'прочее (черновик/шаблон/архив)' end     as курс,
  count(*)                                                            as тем_всего,
  count(*) filter (where t.ege_task_numbers <> '{}')                  as уже_проставлено,
  count(*) filter (where t.ege_task_numbers = '{}'
                     and public.ege_numbers_from_title(t.title) <> '{}') as осталось_проставить
from public.topics t
join public.modules m on m.id = t.module_id
join public.courses c on c.id = m.course_id
group by 1, 2
order by 1, 2;

-- Откат, если разбор окажется негодным: номера проставлены только этим
-- файлом, руками их до сих пор не вводили, поэтому вернуть базу в прежнее
-- состояние можно очисткой колонки по живым курсам.
-- ВНИМАНИЕ: после того как владелец начал вводить номера руками, этот откат
-- сотрёт и его работу. Держать его как «в тот же час», а не «когда-нибудь».
--
-- update public.topics t set ege_task_numbers = '{}'
--   from public.modules m, public.courses c
--  where m.id = t.module_id and c.id = m.course_id
--    and c.is_active and not c.is_draft and not c.is_template;
