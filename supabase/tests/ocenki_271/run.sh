#!/bin/sh
# §271. Пробы PENDING_271 (оценка урока 1–10 и сводка «Оценки уроков») на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5971 -k /var/tmp/pg271 -c listen_addresses=''" (под пользователем postgres).
# Слепок: ../mock_exam_lesson_221/00_slice.sql (профили, курсы, группы, course_is_staff) +
# ../kontrolnaya_240/05_slice_240.sql (модули, темы, student_courses, auth_student_id, course_student_has_access,
# topic_open_now, course_student_can_see_topic — дословно из миграций). Затем данные 10_data_271.sql,
# PENDING_271 ДВАЖДЫ (одной транзакцией каждый, как apply_migration — повтор без ошибок) и пробы 20_probes.sql.
# Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_271:-/var/tmp/pg271}; PT=${PGPORT_271:-5971}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe271" -c "create database probe271" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe271"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
T=$(cd "$(dirname "$0")/.." && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $T/mock_exam_lesson_221/00_slice.sql && $Q -f $T/kontrolnaya_240/05_slice_240.sql >/dev/null && echo "slice: ok" \
 && $Q -f $S/10_data_271.sql && echo "data: ok" \
 && $Q -1 -f $R/20261008094353_topic_ratings_271.sql && $Q -1 -f $R/20261008094353_topic_ratings_271.sql && echo "PENDING_271 applied twice: ok" \
 && psql -h $H -p $PT -U postgres probe271 -f $S/20_probes.sql
