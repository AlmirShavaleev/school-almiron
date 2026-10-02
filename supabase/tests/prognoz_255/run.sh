#!/bin/sh
# §255. Пробы «Примерного балла на ЕГЭ» и «Баллов школы» на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5725 -k /var/tmp/pg255 -c listen_addresses=''" (под пользователем postgres).
# Слепок §254 (../glavnaya_254/00_slice_254.sql) + добавка 05_slice_255, применённая миграция §254
# (20261002140734_student_home_activity.sql — student_visit_streak нужен баллам школы), данные 10_data_255,
# PENDING_255.sql ДВАЖДЫ (одной транзакцией, как apply_migration; повтор без ошибок) и пробы 20_probes.
# Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=notice"
H=${PGHOST_255:-/var/tmp/pg255}; PT=${PGPORT_255:-5725}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe255" -c "create database probe255" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe255"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S/../glavnaya_254/00_slice_254.sql && echo "slice 254: ok" \
 && $Q -f $S/05_slice_255.sql && echo "slice 255: ok" \
 && $Q -1 -f $R/20261002140734_student_home_activity.sql && echo "migration 254: ok" \
 && $Q -f $S/10_data_255.sql && echo "data 255: ok" \
 && $Q -1 -f $R/PENDING_255.sql && $Q -1 -f $R/PENDING_255.sql && echo "PENDING_255 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe255 -f $S/20_probes.sql 2>&1
