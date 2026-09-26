#!/bin/sh
# §231. Пробы прав на mock_exams / mock_exam_results на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5451 -k /var/tmp/pg231" (под пользователем postgres).
# Слепок и данные — ровно цепочка §229 (../mock_exam_variants_229/run.sh: слепок §221/§224/§228 +
# ПРИМЕНЁННЫЕ тексты миграций §218–§229), затем PENDING_231.sql ДВАЖДЫ (повторный прогон без ошибок),
# данные §231 и пробы. Вывод последнего прогона — probes.out рядом.
H=${PGHOST_231:-/var/tmp/pg231}; PT=${PGPORT_231:-5451}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe231" -c "create database probe231" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe231"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S224=$(cd "$(dirname "$0")/../mock_exam_live_224" && pwd)
S228=$(cd "$(dirname "$0")/../mock_exam_v3_228" && pwd)
S229=$(cd "$(dirname "$0")/../mock_exam_variants_229" && pwd)
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
 && $Q -f $S229/05_before_229.sql \
 && $Q -f $R/20260926182241_mock_exam_variants.sql 2>/dev/null \
 && $Q -f $S229/10_data_229.sql \
 && $Q -f $S/10_data_231.sql \
 && $Q -f $R/PENDING_231.sql && $Q -f $R/PENDING_231.sql && echo "PENDING_231 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe231 -f $S/20_probes.sql
