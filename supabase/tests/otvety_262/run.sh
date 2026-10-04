#!/bin/sh
# §262. Пробы PENDING_262a / PENDING_262b на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5862 -k /var/tmp/pg262 -c listen_addresses=''" (под пользователем postgres).
# Слепок §254 + добавки §255, §256 и 05_slice_262 (каждая колонка — с миграцией в шапке), применённые миграции §254–§256
# по порядку (каждая одной транзакцией, как apply_migration), три применённые миграции с invoker-функциями, которые
# 262b переводит в definer (как есть), данные §255 + §256 + 10_data_262, PENDING_262a ДВАЖДЫ, пробы 20_probes_a
# (после 262a, до 262b), PENDING_262b ДВАЖДЫ, пробы 30_probes_b и страховка 40_guard. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=notice"
H=${PGHOST_262:-/var/tmp/pg262}; PT=${PGPORT_262:-5862}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe262" -c "create database probe262" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe262"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
T=$(cd "$(dirname "$0")/.." && pwd)
$Q -f $T/glavnaya_254/00_slice_254.sql && echo "slice 254: ok" \
 && $Q -f $T/prognoz_255/05_slice_255.sql && echo "slice 255: ok" \
 && $Q -f $T/katalog_prognoz_256/05_slice_256.sql && echo "slice 256: ok" \
 && $Q -f $S/05_slice_262.sql && echo "slice 262: ok" \
 && $Q -1 -f $R/20261002140734_student_home_activity.sql && echo "migration 254: ok" \
 && $Q -1 -f $R/20261002152136_student_exam_goals.sql && $Q -1 -f $R/20261002153317_student_exam_goals_policy_and_setter.sql \
 && $Q -1 -f $R/20261002153407_exam_forecast_evidence_and_school_points.sql \
 && $Q -1 -f $R/20261002153604_exam_forecast_evidence_test_topic_via_assignment.sql && echo "migrations 255: ok" \
 && $Q -1 -f $R/20261002174213_catalog_practice_rules_and_tables.sql && $Q -1 -f $R/20261002174335_catalog_practice_evidence_check_reveal.sql \
 && $Q -1 -f $R/20261002174501_catalog_practice_daily_weekly_streak_points.sql && echo "migrations 256: ok" \
 && $Q -1 -f $R/20260912213207_catalog_tasks_attach_preview.sql && $Q -1 -f $R/20260915082230_preview_task_verdict.sql \
 && $Q -1 -f $R/20260812214736_variant_section_counts_split_by_exam_part.sql 2>&1 && echo "invoker-функции (как есть): ok" \
 && $Q -f $T/prognoz_255/10_data_255.sql && echo "data 255: ok" \
 && $Q -f $T/katalog_prognoz_256/10_data_256.sql && echo "data 256: ok" \
 && $Q -f $S/10_data_262.sql && echo "data 262: ok" \
 && $Q -1 -f $R/20261003155843_catalog_answers_server_part_a_functions.sql && echo "PENDING_262a (1): ok" \
 && $Q -1 -f $R/20261003155843_catalog_answers_server_part_a_functions.sql && echo "PENDING_262a (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe262 -f $S/20_probes_a.sql 2>&1 \
 && $Q -1 -f $R/20261004102949_catalog_answers_server_part_b_column_privileges.sql && echo "PENDING_262b (1): ok" \
 && $Q -1 -f $R/20261004102949_catalog_answers_server_part_b_column_privileges.sql && echo "PENDING_262b (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe262 -f $S/30_probes_b.sql 2>&1 \
 && psql -h $H -p $PT -U postgres probe262 -f $S/40_guard.sql 2>&1
