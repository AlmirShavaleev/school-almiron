#!/bin/sh
# §265. Пробы PENDING_265 и PENDING_265_backfill на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5865 -k /var/tmp/pg265 -c listen_addresses=''" (под пользователем postgres).
# Цепочка — §243 (../avtovydacha_243/run.sh: слепок §221 + 05_slice_240 + НАСТОЯЩИЕ файлы ДЗ темы, гейта,
# файлов, синхронизации каркаса, копирования, §198, §234, §240, 05_slice_243 и применённая §243), плюс
# НАСТОЯЩИЙ 20260913195322 (последнее определение template_sync_homework — шкала каркаса) на своём месте.
# Поверх: 10_data_265 (данные «как на проде до §265»: урок без шкалы / урок 5-балльный с оценками /
# урок 100-балльный / проверочная 5-балльная / контрольная без шкалы, каркас с копией в классе),
# PENDING_265 ДВАЖДЫ, проба «что изменится» (prod_before.sql — тот же файл, что запускать на проде),
# PENDING_265_backfill ДВАЖДЫ (второй — ноль изменений), пробы 20_probes.sql и prod_after.sql.
# Каждая миграция — одной транзакцией (-1), как apply_migration. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_265:-/var/tmp/pg265}; PT=${PGPORT_265:-5865}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe265" -c "create database probe265" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe265"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S240=$(cd "$(dirname "$0")/../kontrolnaya_240" && pwd)
S243=$(cd "$(dirname "$0")/../avtovydacha_243" && pwd)
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
 && $Q -f $R/20260913195322_template_sync_fix_order_base_and_grade_scale.sql \
 && $Q -f $R/20260913195406_template_sync_drop_renumber.sql \
 && $Q -f $R/20260913195532_copy_functions_fill_lineage.sql \
 && $Q -f $R/20260917194110_review_attempt_after_return.sql \
 && $Q -1 -f $R/20260927153810_trenirovka_training_track.sql \
 && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql \
 && $Q -f $S243/05_slice_243.sql \
 && $Q -1 -f $R/20260929085322_avtovydacha_dz_svodka.sql \
 && $Q -f $S/05_slice_265.sql \
 && echo "цепочка §243 (+ 20260913195322) + slice 265: ok" \
 && $Q -f $S/10_data_265.sql && echo "data 265 (до §265): ok" \
 && $Q -1 -f $R/20261004111336_grade_scales_part1_triggers_by_topic_kind.sql -f $R/PENDING_265_template_sync.sql && echo "PENDING_265 (1): ok" \
 && $Q -1 -f $R/20261004111336_grade_scales_part1_triggers_by_topic_kind.sql -f $R/PENDING_265_template_sync.sql && echo "PENDING_265 (2, повтор): ok" \
 && echo "=== проба «что изменится» (prod_before.sql) ===" \
 && psql -h $H -p $PT -U postgres probe265 -f $S/prod_before.sql 2>&1 \
 && $Q -1 -f $R/20261004112036_grade_scales_backfill_a_null_scales_not_null.sql -f $R/PENDING_265_backfill_b.sql && echo "PENDING_265_backfill (1): ok" \
 && echo "=== проба «что изменится» после пересчёта — всё ноль ===" \
 && psql -h $H -p $PT -U postgres probe265 -f $S/prod_before.sql 2>&1 \
 && $Q -1 -f $R/20261004112036_grade_scales_backfill_a_null_scales_not_null.sql -f $R/PENDING_265_backfill_b.sql && echo "PENDING_265_backfill (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe265 -f $S/20_probes.sql 2>&1 \
 && echo "=== проверка «после применения» (prod_after.sql) ===" \
 && psql -h $H -p $PT -U postgres probe265 -f $S/prod_after.sql 2>&1
