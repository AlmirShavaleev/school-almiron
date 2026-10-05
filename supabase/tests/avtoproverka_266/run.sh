#!/bin/sh
# §266. Пробы PENDING_266 (задачи с автопроверкой в тренировочном уроке) на ЛОКАЛЬНОМ Postgres 16 (не прод).
# Кластер: initdb + pg_ctl -o "-p 5866 -k /var/tmp/pg266 -c listen_addresses=''" (под пользователем postgres).
# Цепочка — §265 (../shkaly_265/run.sh: слепок §221 + 05_slice_240 + НАСТОЯЩИЕ файлы ДЗ темы, гейта, файлов,
# синхронизации каркаса, копирования, §234, §240, 05_slice_243, применённая §243, 05_slice_265 с course_copy_jobs),
# затем то, что применено на проде после неё: §265 (20261004111336 + оба пересчёта; PENDING_265_template_sync
# НЕ применён на проде — его здесь нет), журнал ДЗ §250 (20261001103824 — проверяем, что оценка автопроверки
# ложится туда), нормализация ответов 20260803163437 (normalize_variant_answer — основа сравнения §266).
# Поверх: 10_data_266 (каркас с тренировочным уроком и класс-копия, посторонний курс), PENDING_266 ДВАЖДЫ
# (одной транзакцией каждый, как apply_migration) и пробы 20_probes.sql. Вывод — probes.out рядом.
export PGOPTIONS="-c client_min_messages=warning"
H=${PGHOST_266:-/var/tmp/pg266}; PT=${PGPORT_266:-5866}
P="psql -h $H -p $PT -U postgres -q"
$P -c "drop database if exists probe266" -c "create database probe266" postgres 2>/dev/null
Q="psql -h $H -p $PT -U postgres -v ON_ERROR_STOP=1 -q probe266"
R=$(cd "$(dirname "$0")/../../migrations" && pwd)
S221=$(cd "$(dirname "$0")/../mock_exam_lesson_221" && pwd)
S240=$(cd "$(dirname "$0")/../kontrolnaya_240" && pwd)
S243=$(cd "$(dirname "$0")/../avtovydacha_243" && pwd)
S265=$(cd "$(dirname "$0")/../shkaly_265" && pwd)
S=$(cd "$(dirname "$0")" && pwd)
$Q -f $S221/00_slice.sql && $Q -f $S240/05_slice_240.sql \
 && $Q -f $R/20260726073913_topic_homework.sql \
 && $Q -f $R/20260726203833_topic_homework_deadline_grades_notify.sql \
 && $Q -f $S240/07_verbatim_240.sql \
 && $Q -f $R/20260802000000_lock_solution_until_reviewed.sql \
 && $Q -f $R/20260805220729_topic_rubrics_and_solution_gate.sql \
 && $Q -f $R/20260808181617_shared_storage_objects_refcount_and_policies.sql \
 && $Q -f $R/20260811222514_attempt_files_writable_only_in_draft.sql \
 && $Q -f $R/20260913194822_template_lineage_columns_and_backfill.sql \
 && $Q -f $R/20260913195011_template_sync_engine.sql \
 && $Q -f $R/20260913195101_template_sync_triggers.sql \
 && $Q -f $R/20260913195322_template_sync_fix_order_base_and_grade_scale.sql \
 && $Q -f $R/20260913195406_template_sync_drop_renumber.sql \
 && $Q -f $R/20260913195532_copy_functions_fill_lineage.sql \
 && $Q -f $R/20260917194110_review_attempt_after_return.sql \
 && $Q -1 -f $R/20260927153810_trenirovka_training_track.sql \
 && $Q -1 -f $R/20260928122420_kontrolnaya_timed_work.sql \
 && $Q -f $S243/05_slice_243.sql \
 && $Q -1 -f $R/20260929085322_avtovydacha_dz_svodka.sql \
 && $Q -f $S265/05_slice_265.sql \
 && $Q -1 -f $R/20261004111336_grade_scales_part1_triggers_by_topic_kind.sql \
 && $Q -1 -f $R/20261004112036_grade_scales_backfill_a_null_scales_not_null.sql -f $R/20261004113844_grade_scales_backfill_b_lesson_five_to_hundred.sql \
 && $Q -1 -f $R/20261001103824_course_homework_grades.sql \
 && $Q -1 -f $R/20260803163437_normalize_variant_answer_trim_after_collapsing_spaces.sql \
 && echo "цепочка §265 (как на проде) + журнал ДЗ §250 + normalize_variant_answer: ok" \
 && $Q -f $S/10_data_266.sql && echo "data 266: ok" \
 && $Q -1 -f $R/PENDING_266.sql && echo "PENDING_266 (1): ok" \
 && $Q -1 -f $R/PENDING_266.sql && echo "PENDING_266 (2, повтор): ok" \
 && psql -h $H -p $PT -U postgres probe266 -f $S/20_probes.sql 2>&1
