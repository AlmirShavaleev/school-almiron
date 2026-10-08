#!/bin/sh
# §269. Пробы PENDING_269_catalog_md на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb (--locale=C.UTF-8: кириллица в проверке слов не должна зависеть от локали) +
#   pg_ctl -o "-p 5869 -k /var/tmp/pg269 -c listen_addresses=''" (под пользователем postgres).
# Цепочка §262 (../otvety_262/run.sh без её проб): слепки §254–§256 + 05_slice_262, миграции §254–§256, данные §255/§256/§262;
# затем 05_slice_269 (колонки и таблицы прода, которых нет в слепках) и 07_prod_functions_269 (тела функций ПРОДА, которые
# правит PENDING_269), PENDING_262a и 262b (права колонок — как на проде), 10_data_269 (старые HTML-задачи, сданный вариант),
# PENDING_269 (1) одной транзакцией, 12_data_md_269 (задачи в Markdown), PENDING_269 (2, повтор) и пробы 20_probes.sql.
# Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=notice"
H=${PGHOST_269:-/var/tmp/pg269}; PT=${PGPORT_269:-5869}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe269" -c "create database probe269" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe269"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
T=$(cd "$(dirname "$0")/.." && pwd)
$Q -f $T/glavnaya_254/00_slice_254.sql && $Q -f $T/prognoz_255/05_slice_255.sql \
 && $Q -f $T/katalog_prognoz_256/05_slice_256.sql && $Q -f $T/otvety_262/05_slice_262.sql && echo "слепки 254–262: ok" \
 && $Q -1 -f $R/20261002140734_student_home_activity.sql \
 && $Q -1 -f $R/20261002152136_student_exam_goals.sql && $Q -1 -f $R/20261002153317_student_exam_goals_policy_and_setter.sql \
 && $Q -1 -f $R/20261002153407_exam_forecast_evidence_and_school_points.sql \
 && $Q -1 -f $R/20261002153604_exam_forecast_evidence_test_topic_via_assignment.sql \
 && $Q -1 -f $R/20261002174213_catalog_practice_rules_and_tables.sql && $Q -1 -f $R/20261002174335_catalog_practice_evidence_check_reveal.sql \
 && $Q -1 -f $R/20261002174501_catalog_practice_daily_weekly_streak_points.sql \
 && $Q -1 -f $R/20260912213207_catalog_tasks_attach_preview.sql && $Q -1 -f $R/20260915082230_preview_task_verdict.sql \
 && $Q -1 -f $R/20260812214736_variant_section_counts_split_by_exam_part.sql 2>/dev/null && echo "миграции 254–256: ok" \
 && $Q -f $T/prognoz_255/10_data_255.sql && $Q -f $T/katalog_prognoz_256/10_data_256.sql && $Q -f $T/otvety_262/10_data_262.sql \
 && echo "данные 255–262: ok" \
 && $Q -f $S/05_slice_269.sql && echo "слепок 269: ok" \
 && $Q -f $S/07_prod_functions_269.sql && echo "функции прода: ok" \
 && $Q -1 -f $R/20261003155843_catalog_answers_server_part_a_functions.sql \
 && $Q -1 -f $R/20261004102949_catalog_answers_server_part_b_column_privileges.sql 2>/dev/null && echo "262a + 262b: ok" \
 && $Q -f $S/10_data_269.sql && echo "данные 269 (старые задачи): ok" \
 && $Q -1 -f $R/20261008191657_catalog_md_269.sql && echo "PENDING_269 (1): ok" \
 && $Q -f $S/12_data_md_269.sql && echo "данные 269 (Markdown): ok" \
 && $Q -1 -f $R/20261008191657_catalog_md_269.sql && echo "PENDING_269 (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe269 -f $S/20_probes.sql 2>&1
