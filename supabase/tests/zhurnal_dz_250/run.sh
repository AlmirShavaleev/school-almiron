#!/bin/sh
# §250. Пробы журнала ДЗ (вкладка курса «Домашние задания») на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5650 -k /var/tmp/pg250" (под пользователем postgres).
# Слепок и миграции — ровно цепочка §249 (../zhurnal_249/run.sh: слепок §221 + 05_slice_240 + НАСТОЯЩИЕ
# файлы миграций ДЗ темы … §240, таблица проверки §199, слепок пробников 05_mock_slice_241), данные §241,
# применённые миграции §241 (20260929062903) и §249 (20261001074629), данные §249 и §250,
# PENDING_250.sql ДВАЖДЫ (одной транзакцией, как apply_migration) и пробы.
# Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_250:-/var/tmp/pg250}; PT=${PGPORT_250:-5650}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe250" -c "create database probe250" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe250"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S240=$(cd "$(dirname "$0")/../kontrolnaya_240" && pwd)
S241=$(cd "$(dirname "$0")/../razdel_241" && pwd)
S249=$(cd "$(dirname "$0")/../zhurnal_249" && pwd)
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
 && echo "slice + prod migrations (§241 chain) + mock slice: ok" \
 && $Q -f $S241/10_data_241.sql \
 && $Q -1 -f $R/20260929062903_course_assessments_section.sql && echo "§241 (applied on prod) : ok" \
 && $Q -f $S249/15_data_249.sql && echo "data §249: ok" \
 && $Q -1 -f $R/20261001074629_course_assessment_grades.sql && echo "§249 (applied on prod) : ok" \
 && $Q -f $S/15_data_250.sql && echo "data §250: ok" \
 && $Q -1 -f $R/PENDING_250.sql && $Q -1 -f $R/PENDING_250.sql && echo "PENDING_250 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe250 -f $S/20_probes.sql
