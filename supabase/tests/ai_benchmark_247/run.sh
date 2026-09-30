#!/bin/sh
# §247. Пробы ai_benchmark_results / ai_benchmark_report / ai_benchmark_candidates на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5547 -k /var/tmp/pg247" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (профили, роли, auth.uid, is_admin_or_owner дословно),
# добавки 05_slice_247.sql (service_role, привилегии по умолчанию как в Supabase, таблицы ДЗ темы —
# подмножество колонок, заглушки помощников прав попытки), затем НАСТОЯЩИЕ миграции таблицы проверки
# §199 (20260917194018, 20260917195055) и §214 (20260922081120), 20260930204647_ai_benchmark_results.sql ДВАЖДЫ (каждый раз
# одной транзакцией, как apply_migration), данные 10_data_247.sql и пробы. Вывод — probes.out рядом.
H=${PGHOST_247:-/var/tmp/pg247}; PT=${PGPORT_247:-5547}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe247" -c "create database probe247" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe247"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S/05_slice_247.sql \
 && $Q -f $R/20260917194018_topic_homework_review_tasks.sql \
 && $Q -f $R/20260917195055_review_tasks_has_verdict_revoke_public.sql \
 && $Q -f $R/20260922081120_review_tasks_verdict_unsolved.sql \
 && $Q -1 -f $R/20260930204647_ai_benchmark_results.sql && $Q -1 -f $R/20260930204647_ai_benchmark_results.sql && echo "20260930204647 applied twice: ok" \
 && $Q -f $S/10_data_247.sql \
 && psql -h $H -p $PT -U postgres probe247 -f $S/20_probes.sql
