#!/bin/sh
# §257. Пробы «Достижения» на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5857 -k /var/tmp/pg257 -c listen_addresses=''" (под пользователем postgres).
# Слепок §254 (../glavnaya_254/00_slice_254.sql) + добавки §255 (../prognoz_255/05_slice_255.sql), §256
# (../katalog_prognoz_256/05_slice_256.sql) и 05_slice_257 (каждая колонка — с миграцией в шапке), применённые
# миграции §254, §255 и §256 по порядку (каждая одной транзакцией, как apply_migration), две применённые миграции §257 ДВАЖДЫ
# (повтор без ошибок), данные §255 + §256 + 10_data_257 и пробы 20_probes. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=notice"
H=${PGHOST_257:-/var/tmp/pg257}; PT=${PGPORT_257:-5857}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe257" -c "create database probe257" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe257"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S/../glavnaya_254/00_slice_254.sql && echo "slice 254: ok" \
 && $Q -f $S/../prognoz_255/05_slice_255.sql && echo "slice 255: ok" \
 && $Q -f $S/../katalog_prognoz_256/05_slice_256.sql && echo "slice 256: ok" \
 && $Q -f $S/05_slice_257.sql && echo "slice 257: ok" \
 && $Q -1 -f $R/20261002140734_student_home_activity.sql && echo "migration 254: ok" \
 && $Q -1 -f $R/20261002152136_student_exam_goals.sql && $Q -1 -f $R/20261002153317_student_exam_goals_policy_and_setter.sql \
 && $Q -1 -f $R/20261002153407_exam_forecast_evidence_and_school_points.sql \
 && $Q -1 -f $R/20261002153604_exam_forecast_evidence_test_topic_via_assignment.sql && echo "migrations 255: ok" \
 && $Q -1 -f $R/20261002174213_catalog_practice_rules_and_tables.sql && $Q -1 -f $R/20261002174335_catalog_practice_evidence_check_reveal.sql \
 && $Q -1 -f $R/20261002174501_catalog_practice_daily_weekly_streak_points.sql && echo "migrations 256: ok" \
 && $Q -1 -f $R/20261002194006_achievements_rules_tables_progress.sql 2>&1 && $Q -1 -f $R/20261002194103_achievements_sync_seen_claim_staff_points.sql 2>&1 && echo "migrations 257 (1): ok" \
 && $Q -1 -f $R/20261002194006_achievements_rules_tables_progress.sql 2>&1 && $Q -1 -f $R/20261002194103_achievements_sync_seen_claim_staff_points.sql 2>&1 && echo "migrations 257 (2, повтор): ok" \
 && $Q -f $S/../prognoz_255/10_data_255.sql && echo "data 255: ok" \
 && $Q -f $S/../katalog_prognoz_256/10_data_256.sql && echo "data 256: ok" \
 && $Q -f $S/10_data_257.sql && echo "data 257: ok" \
 && psql -h $H -p $PT -U postgres probe257 -f $S/20_probes.sql 2>&1
