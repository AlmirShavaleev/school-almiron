#!/bin/sh
# §246. Пробы catalog_my_overview() на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5646 -k /var/tmp/pg246" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (роли, auth.uid(), профили/группы) + 05_slice_246.sql
# (каталог и варианты в колонках src/types/database.ts), данные 10_data_246.sql, PENDING_246.sql ДВАЖДЫ
# (одной транзакцией каждый раз, как apply_migration) и пробы. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_246:-/var/tmp/pg246}; PT=${PGPORT_246:-5646}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe246" -c "create database probe246" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe246"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S/05_slice_246.sql && echo "slice: ok" \
 && $Q -f $S/10_data_246.sql && echo "data: ok" \
 && $Q -1 -f $R/PENDING_246.sql && $Q -1 -f $R/PENDING_246.sql && echo "PENDING_246 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe246 -f $S/20_probes.sql
