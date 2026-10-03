#!/bin/sh
# §263. Пробы PENDING_263 на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5863 -k /var/tmp/pg263 -c listen_addresses=''" (под пользователем postgres).
# Цепочка — ровно §241 (../razdel_241/run.sh: слепок §221 + 05_slice_240 + НАСТОЯЩИЕ файлы миграций ДЗ темы,
# гейта, файлов, синхронизации, §198, §199, §234, §240, слепок пробников 05_mock_slice_241, 20260929062903),
# поверх — 05_slice_263 (каталог и варианты, каждая колонка — с файлом миграции), НАСТОЯЩИЕ файлы
# 20261002174213 (попытки и раскрытия каталога §256) и 20261003155843 (262a), данные §241 + §263,
# пробы «до» (05_probe_before), PENDING_263 (1), выбор учителя после применения, PENDING_263 (2, повтор), пробы.
# Каждая миграция — одной транзакцией (-1), как apply_migration. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_263:-/var/tmp/pg263}; PT=${PGPORT_263:-5863}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe263" -c "create database probe263" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe263"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S240=$(cd "$(dirname "$0")/../kontrolnaya_240" && pwd)
S241=$(cd "$(dirname "$0")/../razdel_241" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S240/05_slice_240.sql \
 && $Q -f $R/20260726073913_topic_homework.sql \
 && $Q -f $R/20260726203833_topic_homework_deadline_grades_notify.sql \
 && $Q -f $S240/07_verbatim_240.sql \
 && $Q -f $R/20260802000000_lock_solution_until_reviewed.sql \
 && $Q -f $R/20260805220729_topic_rubrics_and_solution_gate.sql \
 && $Q -f $R/20260808181617_shared_storage_objects_refcount_and_policies.sql \
 && $Q -f $R/20260811222514_attempt_files_writable_only_in_draft.sql \
 && $Q -f $R/20260913194822_template_lineage_columns_and_backfill.sql \
 && $Q -f $R/20260913195011_template_sync_engine.sql \
 && $Q -f $R/20260913195101_template_sync_triggers.sql \
 && $Q -f $R/20260913195406_template_sync_drop_renumber.sql \
 && $Q -f $R/20260913195532_copy_functions_fill_lineage.sql \
 && $Q -f $R/20260917194018_topic_homework_review_tasks.sql \
 && $Q -f $R/20260917194110_review_attempt_after_return.sql \
 && $Q -f $R/20260922081120_review_tasks_verdict_unsolved.sql \
 && $Q -1 -f $R/20260927153810_trenirovka_training_track.sql \
 && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql \
 && $Q -f $S241/05_mock_slice_241.sql \
 && $Q -1 -f $R/20260929062903_course_assessments_section.sql \
 && echo "цепочка §241: ok" \
 && $Q -f $S/05_slice_263.sql && echo "slice 263: ok" \
 && $Q -1 -f $R/20261002174213_catalog_practice_rules_and_tables.sql && echo "20261002174213 (§256, таблицы каталога): ok" \
 && $Q -1 -f $R/20261003155843_catalog_answers_server_part_a_functions.sql && echo "20261003155843 (262a): ok" \
 && $Q -f $S241/10_data_241.sql > /dev/null && echo "data 241: ok" \
 && $Q -f $S/10_data_263.sql && echo "data 263: ok" \
 && psql -h $H -p $PT -U postgres probe263 -f $S/15_probe_before.sql 2>&1 \
 && $Q -1 -f $R/PENDING_263.sql && echo "PENDING_263 (1): ok" \
 && $Q -c "update test_variant_assignments set show_answers_after_submit = false, show_solutions_after_submit = false where id = '00000000-0000-4000-8000-0000000bc002'" \
 && echo "учитель после применения снял оба флажка у tva2" \
 && $Q -1 -f $R/PENDING_263.sql && echo "PENDING_263 (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe263 -f $S/20_probes.sql 2>&1
