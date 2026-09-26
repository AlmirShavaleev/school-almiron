#!/bin/sh
# §228. Пробы на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5448 -k /var/tmp/pg228" (под пользователем postgres).
# Слепок — как в §224 (../mock_exam_lesson_221: 00/05/06b/07 и данные 10, ../mock_exam_live_224: данные),
# поверх — ПРИМЕНЁННЫЕ тексты миграций §218, §219, §221, §223, §224, §224.1 из supabase/migrations,
# затем 20260926125435_mock_exams_group_change_guard.sql дважды (проверка повторного прогона) и данные §228.
# Вывод последнего прогона — probes.out рядом.
H=${PGHOST_228:-/var/tmp/pg228}; PT=${PGPORT_228:-5448}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe228" -c "create database probe228" postgres
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe228"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S224=$(cd "$(dirname "$0")/../mock_exam_live_224" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S221/05_slice_219.sql && $Q -f $S221/06b_slice_221.sql && $Q -f $S221/07_variant_verbatim.sql \
 && $Q -f $R/20260925201156_mock_exam_templates_and_task_scores.sql 2>/dev/null \
 && $Q -f $S221/06_seed218.sql >/dev/null \
 && $Q -f $R/20260925211232_mock_exam_results_notify.sql \
 && $Q -f $R/20260926051556_mock_exam_lesson_window_sheet_photos.sql 2>/dev/null \
 && $Q -f $R/20260926060726_mock_exam_notify_stats.sql \
 && $Q -f $S221/10_data.sql \
 && $Q -f $S224/10_data_224.sql \
 && $Q -f $R/20260926065848_mock_exam_live_section_reminders.sql 2>/dev/null \
 && $Q -f $R/20260926070810_mock_exam_reminder_link_course.sql 2>/dev/null \
 && $Q -f $R/20260926125435_mock_exams_group_change_guard.sql && $Q -f $R/20260926125435_mock_exams_group_change_guard.sql && echo "PENDING_228 applied twice: ok" \
 && $Q -f $S/10_data_228.sql \
 && psql -h $H -p $PT -U postgres probe228 -f $S/20_probes.sql
