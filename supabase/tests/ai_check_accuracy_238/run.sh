#!/bin/sh
# §238. Пробы ai_check_accuracy на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5538 -k /var/tmp/pg238" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (профили, роли, auth.uid, is_admin_or_owner
# дословно), добавки 05_slice_238.sql (topic_homework_attempts/reviews/ai_jobs — подмножество
# колонок, заглушки помощников прав попытки), затем НАСТОЯЩИЕ миграции таблицы проверки §199
# (20260917194018, 20260917195055) и §214 (20260922081120), данные 10_data_238.sql,
# PENDING_238.sql ДВАЖДЫ (одной транзакцией, как apply_migration) и пробы. Вывод — probes.out рядом.
H=${PGHOST_238:-/var/tmp/pg238}; PT=${PGPORT_238:-5538}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe238" -c "create database probe238" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe238"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S/05_slice_238.sql \
 && $Q -f $R/20260917194018_topic_homework_review_tasks.sql \
 && $Q -f $R/20260917195055_review_tasks_has_verdict_revoke_public.sql \
 && $Q -f $R/20260922081120_review_tasks_verdict_unsolved.sql \
 && $Q -f $S/10_data_238.sql \
 && $Q -1 -f $R/PENDING_238.sql && $Q -1 -f $R/PENDING_238.sql && echo "PENDING_238 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe238 -f $S/20_probes.sql
