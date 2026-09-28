#!/bin/sh
# §240. Пробы «Проверочной/Контрольной работы» на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5540 -k /var/tmp/pg240" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (профили, курсы, группы,
# course_is_staff) + 05_slice_240.sql (темы, материалы, помощники прав,
# заглушки Storage/рассылок/cron), поверх — НАСТОЯЩИЕ файлы миграций с
# последними определениями того, что меняет §240: ДЗ темы (20260726073913,
# 20260726203833), гейт решения (20260802000000, 20260805220729), видимость
# файлов (20260808181617), страницы только в черновике (20260811222514),
# синхронизация каркаса и копирование (20260913194822/195011/195101/195406/195532),
# сторож и вердикт §198 (20260917194110), тренировка §234 (20260927153810);
# 07_verbatim_240.sql — сдача (дословно) и заглушки уведомлений.
# Затем данные до §240, PENDING_240.sql ДВАЖДЫ (одной транзакцией, как
# apply_migration) и пробы. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_240:-/var/tmp/pg240}; PT=${PGPORT_240:-5540}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe240" -c "create database probe240" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe240"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S/05_slice_240.sql \
 && $Q -f $R/20260726073913_topic_homework.sql \
 && $Q -f $R/20260726203833_topic_homework_deadline_grades_notify.sql \
 && $Q -f $S/07_verbatim_240.sql \
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
 && $Q -f $S/10_data_240.sql \
 && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql && echo "PENDING_240 applied twice: ok" \
 && $Q -f $S/15_data_after_240.sql \
 && psql -h $H -p $PT -U postgres probe240 -f $S/20_probes.sql
