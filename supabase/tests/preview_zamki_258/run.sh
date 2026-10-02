#!/bin/sh
# §258. Пробы topic_solution_state (has_criteria / has_condition) на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5958 -k /var/tmp/pg258 -c listen_addresses=''" (под пользователем postgres).
# Слепок и миграции — ровно как в ../kontrolnaya_240/run.sh (00_slice §221 + 05_slice_240 + настоящие
# миграции до §234 включительно), затем данные §240, применённая миграция §240 (20260928122420), данные
# после §240, данные 10_data_258, проба «до» (прежнее тело функции), PENDING_258.sql ДВАЖДЫ (каждый раз
# одной транзакцией, как apply_migration) и пробы 20_probes. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_258:-/var/tmp/pg258}; PT=${PGPORT_258:-5958}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe258" -c "create database probe258" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe258"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S240=$(cd "$(dirname "$0")/../kontrolnaya_240" && pwd)
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
 && $Q -f $R/20260917194110_review_attempt_after_return.sql \
 && $Q -1 -f $R/20260927153810_trenirovka_training_track.sql \
 && echo "slice + prod migrations: ok" \
 && $Q -f $S240/10_data_240.sql \
 && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql && echo "migration 240: ok" \
 && $Q -f $S240/15_data_after_240.sql \
 && $Q -f $S/10_data_258.sql && echo "data 258: ok" \
 && psql -h $H -p $PT -U postgres probe258 -f $S/05_probe_before.sql \
 && $Q -1 -f $R/PENDING_258.sql && $Q -1 -f $R/PENDING_258.sql && echo "PENDING_258 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe258 -f $S/20_probes.sql
