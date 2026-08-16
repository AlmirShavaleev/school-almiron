-- Зачисление в курс-шаблон отклоняется на уровне БАЗЫ.
--
-- Шаблон — каркас, из которого делают классы; учеников в нём быть не может по
-- определению. Вчера для шаблонов отключили ссылки записи, сегодня нашлась
-- дыра в админском окне «Распределить ученика». Прятать в интерфейсе мало:
-- путей зачисления уже пять (`distribute_join_request`,
-- `distribute_student_courses`, `_accept_invite_core`, `course_join_accept`,
-- `invite_student_flow`), и каждый следующий повторит ту же ошибку.
--
-- Поэтому запрет ставится ОДИН раз и там, где членство реально появляется —
-- на вставку в `group_students`. Это закрывает все пять путей сразу и любой
-- шестой, который заведут потом, не зная про шаблоны.
--
-- Не в каждую RPC отдельной проверкой: пять копий одного правила — ровно тот
-- рассинхрон, который породил §21 и §29.

create or replace function public.reject_enrollment_into_template()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_title text;
begin
  select c.title into v_title
    from public.groups g
    join public.courses c on c.id = g.course_id
   where g.id = new.group_id
     and c.is_template;

  if v_title is not null then
    -- Текст читаемый: он доходит до преподавателя как есть. Код в HINT —
    -- чтобы клиент мог опознать причину, не разбирая русскую строку.
    raise exception 'Нельзя зачислить ученика в шаблон курса «%». Шаблон — каркас, из него делают класс, а зачисляют уже в класс.', v_title
      using errcode = 'P0001', hint = 'COURSE_IS_TEMPLATE';
  end if;

  return new;
end;
$fn$;

drop trigger if exists group_students_reject_template on public.group_students;
create trigger group_students_reject_template
  before insert on public.group_students
  for each row execute function public.reject_enrollment_into_template();

comment on function public.reject_enrollment_into_template() is
  'Запрет зачисления в курс-шаблон. Висит на INSERT в group_students, потому '
  'что это единственное место, через которое проходят ВСЕ пути зачисления — '
  'приглашения, ссылки курса, распределение заявок и админское окно.';
