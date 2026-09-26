#!/bin/sh
# §229. Пробы на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5449 -k /var/tmp/pg229" (свой, у агента §229).
# Слепок — как в §228 (../mock_exam_lesson_221: 00/05/06b/07 и данные 10, ../mock_exam_live_224: данные,
# ../mock_exam_v3_228: данные), поверх — ПРИМЕНЁННЫЕ тексты миграций §218–§228 из supabase/migrations,
# затем данные «до §229» (пробник без вариантов, которым станет пробник, заведённый старым экраном),
# PENDING_229.sql ДВАЖДЫ (перенос данных идемпотентен), данные §229 и пробы.
# Вывод последнего прогона — probes.out рядом.
H=${PGHOST_229:-/var/tmp/pg229}; PT=${PGPORT_229:-5449}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe229" -c "create database probe229" postgres
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe229"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S224=$(cd "$(dirname "$0")/../mock_exam_live_224" && pwd)
S228=$(cd "$(dirname "$0")/../mock_exam_v3_228" && pwd)
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
 && $Q -f $R/20260926125435_mock_exams_group_change_guard.sql 2>/dev/null \
 && $Q -f $S228/10_data_228.sql \
 && $Q -f $S/05_before_229.sql \
 && $Q -f $R/PENDING_229.sql 2>/dev/null && $Q -f $R/PENDING_229.sql 2>/dev/null && echo "PENDING_229 applied twice: ok" \
 && $Q -f $S/10_data_229.sql \
 && psql -h $H -p $PT -U postgres probe229 -f $S/20_probes.sql
