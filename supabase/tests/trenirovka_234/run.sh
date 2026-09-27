#!/bin/sh
# §234. Пробы вкладки «Тренировка» на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5534 -k /var/tmp/pg234" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (профили, курсы, группы,
# course_is_staff) + 05_slice_234.sql (темы, материалы, ДЗ, помощники прав),
# поверх — НАСТОЯЩИЕ файлы миграций с последними определениями того, что
# меняет §234: гейт решения (20260802, 20260805), видимость файлов (20260808181617),
# аналитика (20260808220959), «тема пройдена» (20260912212919), синхронизация
# каркаса (20260913195011/195101/195406) и копирование (20260913195532).
# Затем данные до §234, PENDING_234.sql ДВАЖДЫ (одной транзакцией, как
# apply_migration) и пробы. Вывод — probes.out рядом.
H=${PGHOST_234:-/var/tmp/pg234}; PT=${PGPORT_234:-5534}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe234" -c "create database probe234" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe234"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S/05_slice_234.sql \
 && $Q -f $R/20260802000000_lock_solution_until_reviewed.sql 2>/dev/null \
 && $Q -f $R/20260805220729_topic_rubrics_and_solution_gate.sql 2>/dev/null \
 && $Q -f $R/20260808181617_shared_storage_objects_refcount_and_policies.sql 2>/dev/null \
 && $Q -f $R/20260808220959_school_analytics_fix_staff_course_ids_alias.sql \
 && $Q -f $R/20260912212919_topic_done_counts_tasks_by_carrier_variant.sql \
 && $Q -f $R/20260913195011_template_sync_engine.sql 2>/dev/null \
 && $Q -f $R/20260913195101_template_sync_triggers.sql 2>/dev/null \
 && $Q -f $R/20260913195406_template_sync_drop_renumber.sql 2>/dev/null \
 && $Q -f $R/20260913195532_copy_functions_fill_lineage.sql \
 && $Q -f $S/10_data_234.sql \
 && $Q -1 -f $R/20260927153810_trenirovka_training_track.sql 2>/dev/null && $Q -1 -f $R/20260927153810_trenirovka_training_track.sql 2>/dev/null && echo "PENDING_234 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe234 -f $S/20_probes.sql
