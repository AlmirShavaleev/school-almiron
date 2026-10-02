#!/bin/sh
# §254. Пробы главной ученика (student_home_activity) на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5654 -k /var/tmp/pg254 -c listen_addresses=''" (под пользователем postgres).
# Слепок 00_slice_254 (подмножество таблиц, topic_open_now и topic_done_events — дословно), данные 10_data_254,
# 20261002140734_student_home_activity.sql ДВАЖДЫ (одной транзакцией, как apply_migration; повтор без ошибок) и пробы 20_probes.
# Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=notice"
H=${PGHOST_254:-/var/tmp/pg254}; PT=${PGPORT_254:-5654}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe254" -c "create database probe254" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe254"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S/00_slice_254.sql && echo "slice 254: ok" \
 && $Q -f $S/10_data_254.sql && echo "data 254: ok" \
 && $Q -1 -f $R/20261002140734_student_home_activity.sql && $Q -1 -f $R/20261002140734_student_home_activity.sql && echo "PENDING_254 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe254 -f $S/20_probes.sql 2>&1
