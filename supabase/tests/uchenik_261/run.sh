#!/bin/sh
# §261. Пробы PENDING_261 на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5961 -k /var/tmp/pg261 -c listen_addresses=''" (под пользователем postgres).
# Слепок §254 (../glavnaya_254/00_slice_254.sql) + добавки §255, §256, §257 и 05_slice_261 (каждая колонка — с
# миграцией в шапке), применённые миграции §254–§257 по порядку (каждая одной транзакцией, как apply_migration),
# применённая миграция отчёта §217 (20260925184917) — как есть, данные §255 + §256 + §257 + 10_data_261, снимок
# ответов ДО PENDING (15_snapshot_old — для проб «прежний контракт»), PENDING_261 ДВАЖДЫ (повтор без ошибок)
# и пробы 20_probes. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=notice"
H=${PGHOST_261:-/var/tmp/pg261}; PT=${PGPORT_261:-5961}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe261" -c "create database probe261" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe261"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
T=$(cd "$(dirname "$0")/.." && pwd)
$Q -f $T/glavnaya_254/00_slice_254.sql && echo "slice 254: ok" \
 && $Q -f $T/prognoz_255/05_slice_255.sql && echo "slice 255: ok" \
 && $Q -f $T/katalog_prognoz_256/05_slice_256.sql && echo "slice 256: ok" \
 && $Q -f $T/dostizheniya_257/05_slice_257.sql && echo "slice 257: ok" \
 && $Q -f $S/05_slice_261.sql && echo "slice 261: ok" \
 && $Q -1 -f $R/20260925184917_student_progress_report_and_next_steps.sql && echo "migration 217: ok" \
 && $Q -1 -f $R/20261002140734_student_home_activity.sql && echo "migration 254: ok" \
 && $Q -1 -f $R/20261002152136_student_exam_goals.sql && $Q -1 -f $R/20261002153317_student_exam_goals_policy_and_setter.sql \
 && $Q -1 -f $R/20261002153407_exam_forecast_evidence_and_school_points.sql \
 && $Q -1 -f $R/20261002153604_exam_forecast_evidence_test_topic_via_assignment.sql && echo "migrations 255: ok" \
 && $Q -1 -f $R/20261002174213_catalog_practice_rules_and_tables.sql && $Q -1 -f $R/20261002174335_catalog_practice_evidence_check_reveal.sql \
 && $Q -1 -f $R/20261002174501_catalog_practice_daily_weekly_streak_points.sql && echo "migrations 256: ok" \
 && $Q -1 -f $R/20261002194006_achievements_rules_tables_progress.sql && $Q -1 -f $R/20261002194103_achievements_sync_seen_claim_staff_points.sql && echo "migrations 257: ok" \
 && $Q -f $T/prognoz_255/10_data_255.sql && echo "data 255: ok" \
 && $Q -f $T/katalog_prognoz_256/10_data_256.sql && echo "data 256: ok" \
 && $Q -f $T/dostizheniya_257/10_data_257.sql && echo "data 257: ok" \
 && $Q -f $S/10_data_261.sql && echo "data 261: ok" \
 && $Q -f $S/15_snapshot_old.sql && echo "snapshot before PENDING_261: ok" \
 && $Q -1 -f $R/20261003114402_student_overview_part1_forecast_evidence_of.sql && $Q -1 -f $R/20261003114440_student_overview_part2_school_points_of.sql && $Q -1 -f $R/20261003114528_student_overview_part3_work_rows_overview_for_staff.sql && $Q -1 -f $R/20261003114628_student_overview_part4_progress_report_new_fields.sql && echo "§261 (4 части) (1): ok" \
 && $Q -1 -f $R/20261003114402_student_overview_part1_forecast_evidence_of.sql && $Q -1 -f $R/20261003114440_student_overview_part2_school_points_of.sql && $Q -1 -f $R/20261003114528_student_overview_part3_work_rows_overview_for_staff.sql && $Q -1 -f $R/20261003114628_student_overview_part4_progress_report_new_fields.sql && echo "§261 (4 части) (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe261 -f $S/20_probes.sql 2>&1
