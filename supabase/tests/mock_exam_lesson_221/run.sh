#!/bin/sh
# §221. Пробы на ЛОКАЛЬНОМ Postgres 16 (не прод). Кластер: initdb + pg_ctl -o "-p 5441 -k /var/tmp/pg221".
# Слепок: 00/05 — из проб §218/§219, 06b/07 — §221 (07 — дословно из supabase/migrations).
# Вывод последнего прогона — probes.out рядом.
P="psql -h /var/tmp/pg221 -p 5441 -U postgres -q"
$P -c "drop database if exists probe" -c "create database probe" postgres
Q="psql -h /var/tmp/pg221 -p 5441 -U postgres -v ON_ERROR_STOP=1 -q probe"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S/00_slice.sql && $Q -f $S/05_slice_219.sql && $Q -f $S/06b_slice_221.sql && $Q -f $S/07_variant_verbatim.sql \
 && $Q -f $R/20260925201156_mock_exam_templates_and_task_scores.sql 2>/dev/null \
 && $Q -f $S/06_seed218.sql >/dev/null \
 && $Q -f $R/20260925211232_mock_exam_results_notify.sql \
 && $Q -f $R/PENDING_221.sql && $Q -f $R/PENDING_221.sql && echo "PENDING_221 applied twice: ok" \
 && $Q -f $S/10_data.sql \
 && psql -h /var/tmp/pg221 -p 5441 -U postgres probe -f $S/20_probes.sql
