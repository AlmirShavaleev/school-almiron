#!/bin/sh
# §233. Пробы главной преподавателя на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5533 -k /var/tmp/pg233" (под пользователем postgres).
# Слепок и данные — цепочка §231 (../mock_exam_rights_231/run.sh: слепок §221/§224/§228/§229 +
# ПРИМЕНЁННЫЕ тексты миграций §218–§231), затем добавки слепка §233 (topic_homework*,
# notification_prefs, колонки открытости тем и т. п.), данные §233,
# PENDING_233.sql ДВАЖДЫ (повторный прогон без ошибок) и пробы. Вывод — probes.out рядом.
H=${PGHOST_233:-/var/tmp/pg233}; PT=${PGPORT_233:-5533}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe233" -c "create database probe233" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe233"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S224=$(cd "$(dirname "$0")/../mock_exam_live_224" && pwd)
S228=$(cd "$(dirname "$0")/../mock_exam_v3_228" && pwd)
S229=$(cd "$(dirname "$0")/../mock_exam_variants_229" && pwd)
S231=$(cd "$(dirname "$0")/../mock_exam_rights_231" && pwd)
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
 && $Q -f $S231/10_data_231.sql \
 && $Q -f $R/20260926220159_mock_exam_rights.sql \
 && $Q -f $S/05_slice_233.sql \
 && $Q -f $S/10_data_233.sql \
 && $Q -f $R/PENDING_233.sql && $Q -f $R/PENDING_233.sql && echo "233 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe233 -f $S/20_probes.sql
