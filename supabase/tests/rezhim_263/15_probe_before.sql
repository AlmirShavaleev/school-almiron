-- §263. ДО PENDING_263: у S1 идёт контрольная K, но сервер ничего не закрывает — каталог и теория видны.
\pset null '∅'
\pset footer off
\echo '=== B0. До PENDING_263: S1 (идёт K) читает каталог и теорию урока L — всё видно (дыра, которую закрывает §263).'
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
select 'catalog_tasks видно' as what, count(*) from catalog_tasks
union all
select 'материалы L (теория, конспект)', count(*) from topic_material_items where topic_id = '00000000-0000-4000-8000-0000007a0001'
union all
select 'k1 через catalog_task_texts: allowed', count(*) from catalog_task_texts(array['00000000-0000-4000-8000-0000000ca0a1'::uuid]) where allowed;
rollback;
\echo '=== B1. До PENDING_263: флажки выдач вариантов (tva1 false/false, tva2 true/false, tva3 true/true).'
select id, show_answers_after_submit as answers, show_solutions_after_submit as solutions
  from test_variant_assignments where variant_id is not null order by id;
