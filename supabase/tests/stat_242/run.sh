#!/bin/sh
# §242. Пробы статистики курса на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5642 -k /var/tmp/pg242" (под пользователем postgres).
# Слепок и миграции — цепочка §241 (../razdel_241/run.sh: слепок §221 + 05_slice_240 + НАСТОЯЩИЕ файлы
# ДЗ темы, гейта, файлов, синхронизации, таблицы проверки §199, §234 (тренировка: track/subtopic, скрытые подтемы),
# §240 (работы по времени, последняя редакция topic_material_items_student_select) + слепок пробников §241),
# поверх — 05_slice_242 (auth_is_staff_of_topic дословно, ключ material_views), НАСТОЯЩИЕ файлы видео §204
# (20260917230035, 20260917230444), данные §242, PENDING_242.sql ДВАЖДЫ (одной транзакцией, как apply_migration)
# и пробы. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_242:-/var/tmp/pg242}; PT=${PGPORT_242:-5642}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe242" -c "create database probe242" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe242"
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
 && $Q -f $S/05_slice_242.sql \
 && $Q -1 -f $R/20260917230035_video_watch_daily.sql \
 && $Q -1 -f $R/20260917230444_video_watch_add_staff_before_visibility.sql \
 && echo "slice + prod migrations (§241 chain + video §204) + slice 242: ok" \
 && $Q -f $S/10_data_242.sql \
 && $Q -1 -f $R/PENDING_242.sql && $Q -1 -f $R/PENDING_242.sql && echo "PENDING_242 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe242 -f $S/20_probes.sql
