#!/bin/sh
# §224. Пробы на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5442 -k /var/tmp/pg224" (под пользователем postgres).
# Слепок — файлы §221 (../mock_exam_lesson_221: 00/05/06b/07 и данные 10),
# поверх — ПРИМЕНЁННЫЕ тексты миграций §218, §219, §221, §223 из
# supabase/migrations, затем PENDING_224.sql дважды (проверка повторного прогона).
# Вывод последнего прогона — probes.out рядом.
H=${PGHOST_224:-/var/tmp/pg224}; PT=${PGPORT_224:-5442}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe224" -c "create database probe224" postgres
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe224"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S221/05_slice_219.sql && $Q -f $S221/06b_slice_221.sql && $Q -f $S221/07_variant_verbatim.sql \
 && $Q -f $R/20260925201156_mock_exam_templates_and_task_scores.sql 2>/dev/null \
 && $Q -f $S221/06_seed218.sql >/dev/null \
 && $Q -f $R/20260925211232_mock_exam_results_notify.sql \
 && $Q -f $R/20260926051556_mock_exam_lesson_window_sheet_photos.sql 2>/dev/null \
 && $Q -f $R/20260926060726_mock_exam_notify_stats.sql \
 && $Q -f $S221/10_data.sql \
 && $Q -f $S/10_data_224.sql \
 && $Q -f $R/PENDING_224.sql 2>/dev/null && $Q -f $R/PENDING_224.sql 2>/dev/null && echo "PENDING_224 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe224 -f $S/20_probes.sql
