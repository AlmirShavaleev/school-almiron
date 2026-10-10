#!/usr/bin/env bash
# §287. Гонка погашения промокода на НАСТОЯЩЕМ Postgres (в PGlite одно
# соединение — одновременность там не проверить).
#
# Поднимает временный кластер (trust, только localhost, свой порт), грузит
# заглушки и цепочку миграций подписки, затем pgbench запускает одновременные
# оформления с одним кодом. Проверяет: лимит не превышен, погашений ровно
# столько, сколько разрешено, один ученик в N параллельных запросах занимает
# код один раз. Кластер удаляется в конце.
#
#   PG_BIN="/c/Program Files/PostgreSQL/15/bin" bash scripts/subscription-promo-race.sh
set -euo pipefail

PG_BIN="${PG_BIN:-/c/Program Files/PostgreSQL/15/bin}"
PORT="${PORT:-54329}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$ROOT/../.tmp-promo-race}"
MIG="$ROOT/supabase/migrations"
CLIENTS=40
LIMIT=5

rm -rf "$WORK"; mkdir -p "$WORK"
"$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust -E UTF8 --locale=C >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses=localhost -c max_connections=100" -l "$WORK/log" -w start >/dev/null
trap '"$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

PSQL=("$PG_BIN/psql" -h localhost -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
pick() { ls "$MIG" | grep -E "$1" | head -1; }
"${PSQL[@]}" -f "$ROOT/src/test/sql/subscriptionStubs.sql" >/dev/null
for re in '^[0-9]+_subscriptions_282\.sql$' '^[0-9]+_subscription_renew_282\.sql$' \
          '^[0-9]+_hotfix_284_gates_without_subscription\.sql$' '^[0-9]+_perf_284a_student_topic_sets\.sql$' \
          '^[0-9]+_perf_284c_staff_topic_set\.sql$' '^(PENDING_282_2|[0-9]+)_subscription_sets(_282_2)?\.sql$' \
          '^(PENDING_287|[0-9]+)_promo_testers(_287)?\.sql$'; do
  f="$(pick "$re")"; [ -n "$f" ] || { echo "нет миграции $re"; exit 1; }
  "${PSQL[@]}" -f "$MIG/$f" >/dev/null 2>"$WORK/mig.err" || { cat "$WORK/mig.err"; exit 1; }
done

"${PSQL[@]}" <<SQL
update app_feature_flags set enabled = true where key = 'subscriptions';
update subscription_settings set audience = 'everyone';
insert into profiles (id, email, full_name, role)
select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'r' || n || '@t.ru', 'Гонка ' || n, 'student'
  from generate_series(1, $CLIENTS + 1) n;
insert into profiles (id, email, full_name, role) values ('00000000-0000-0000-0000-000000009999', 'a@t.ru', 'Админ', 'admin');
insert into courses (id, title) values ('00000000-0000-0000-0000-00000000c001', 'Курс гонки');
insert into subscription_tariffs (id, course_id, title, price_rub, is_active)
values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000c001', 'Месяц', 1000, true);
select set_config('test.uid', '00000000-0000-0000-0000-000000009999', false);
select admin_promo_create('{"kind":"percent","percent":50,"code":"RACE5","max_uses":$LIMIT}'::jsonb);
select admin_promo_create('{"kind":"percent","percent":50,"code":"SAME1","max_uses":1}'::jsonb);
SQL

# 1) 40 разных учеников одновременно, лимит 5
cat > "$WORK/many.sql" <<'SQL'
select subscription_checkout_begin(('00000000-0000-0000-0000-' || lpad(:client_id + 1 || '', 12, '0'))::uuid,
  '00000000-0000-0000-0000-00000000a001', false, false, false, true, null, 'RACE5');
SQL
"$PG_BIN/pgbench" -h localhost -p "$PORT" -U postgres -n -c $CLIENTS -j 8 -t 1 -f "$WORK/many.sql" postgres >"$WORK/pgbench1.log" 2>&1 || { tail -20 "$WORK/pgbench1.log"; exit 1; }

# 2) один и тот же ученик — 20 запросов одновременно, лимит 1
cat > "$WORK/same.sql" <<SQL
select subscription_checkout_begin('00000000-0000-0000-0000-0000000000$(printf '%02d' $((CLIENTS + 1)))',
  '00000000-0000-0000-0000-00000000a001', false, false, false, true, null, 'SAME1');
SQL
"$PG_BIN/pgbench" -h localhost -p "$PORT" -U postgres -n -c 20 -j 8 -t 1 -f "$WORK/same.sql" postgres >"$WORK/pgbench2.log" 2>&1 || { tail -20 "$WORK/pgbench2.log"; exit 1; }

"${PSQL[@]}" -A -t <<'SQL'
select 'RACE5: used_count=' || used_count || ' max_uses=' || max_uses
       || ' redemptions=' || (select count(*) from subscription_promo_redemptions r where r.code_id = c.id)
       || ' payments_with_code=' || (select count(*) from subscription_payments p
                                      join subscription_promo_redemptions r on r.id = p.promo_redemption_id where r.code_id = c.id)
       || ' rejected_limit=' || (select count(*) from subscription_log where event = 'promo_rejected'
                                   and details->>'code' = 'RACE5' and details->>'reason' = 'limit')
  from subscription_promo_codes c where code = 'RACE5';
select 'SAME1: used_count=' || used_count
       || ' redemptions=' || (select count(*) from subscription_promo_redemptions r where r.code_id = c.id)
       || ' payments_with_code=' || (select count(*) from subscription_payments p
                                      join subscription_promo_redemptions r on r.id = p.promo_redemption_id where r.code_id = c.id)
  from subscription_promo_codes c where code = 'SAME1';
SQL
grep -E "number of (transactions actually processed|failed transactions)" "$WORK/pgbench1.log" "$WORK/pgbench2.log" | sed "s#$WORK/##"
