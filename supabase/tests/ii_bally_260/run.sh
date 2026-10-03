#!/bin/sh
# §260. Пробы PENDING_260 на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5826 -k /var/tmp/pg260" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (профили, роли, auth.uid, is_admin_or_owner)
# и ../ai_check_accuracy_238/05_slice_238.sql (попытки, вердикты, ai_jobs, заглушки прав
# попытки), затем НАСТОЯЩИЕ миграции таблицы проверки §199 (20260917194018, 20260917195055)
# и §214 (20260922081120), PENDING_260 ДВАЖДЫ (одной транзакцией каждый, как apply_migration),
# данные 10_data_260.sql и пробы 20_probes.sql. Вывод — probes.out рядом.
H=${PGHOST_260:-/var/tmp/pg260}; PT=${PGPORT_260:-5826}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe260" -c "create database probe260" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe260"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S238=$(cd "$(dirname "$0")/../ai_check_accuracy_238" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S238/05_slice_238.sql \
 && $Q -f $R/20260917194018_topic_homework_review_tasks.sql \
 && $Q -f $R/20260917195055_review_tasks_has_verdict_revoke_public.sql \
 && $Q -f $R/20260922081120_review_tasks_verdict_unsolved.sql \
 && $Q -f $S/10_data_260.sql \
 && $Q -1 -f $R/PENDING_260.sql && $Q -1 -f $R/PENDING_260.sql && echo "PENDING_260 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe260 -f $S/20_probes.sql
