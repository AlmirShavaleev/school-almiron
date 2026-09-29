#!/bin/sh
# §243. Пробы «тема открыта = ДЗ выдано» и сводки новых ДЗ на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5643 -k /var/tmp/pg243" (под пользователем postgres).
# Слепок и миграции — цепочка §240 (../kontrolnaya_240/run.sh: слепок §221 + 05_slice_240 +
# НАСТОЯЩИЕ файлы ДЗ темы, гейта, файлов, синхронизации каркаса, копирования, §198, §234, §240),
# поверх — 05_slice_243 (очередь, колокольчик, Telegram, joined_at/is_active, card_title),
# данные ДО миграции, миграцию §243 ДВАЖДЫ (одной транзакцией, как apply_migration; второй
# прогон — разовая выдача находит ноль) и пробы. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_243:-/var/tmp/pg243}; PT=${PGPORT_243:-5643}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe243" -c "create database probe243" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe243"
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
 && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql \
 && $Q -f $S/05_slice_243.sql \
 && echo "slice + prod migrations (§240 chain) + slice 243: ok" \
 && $Q -f $S/10_data_243.sql \
 && $Q -1 -f $R/20260929085322_avtovydacha_dz_svodka.sql && $Q -1 -f $R/20260929085322_avtovydacha_dz_svodka.sql && echo "PENDING_243 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe243 -f $S/20_probes.sql
