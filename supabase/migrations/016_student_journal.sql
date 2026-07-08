-- Etap 6: unified student journal read model.
-- get_student_journal aggregates lessons + attendance + assigned_collections +
-- task_submissions into one JSONB read model, scoped by role, period and subject.
-- No new tables — everything is computed from existing Etap 4/5 data.

CREATE OR REPLACE FUNCTION get_student_journal(
  p_student_id uuid,
  p_date_from  timestamptz DEFAULT NULL,
  p_date_to    timestamptz DEFAULT NULL,
  p_subject    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_result jsonb;
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'p_student_id is required';
  END IF;

  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid period: date_from is after date_to';
  END IF;

  v_role := get_my_role();
  IF v_role = 'student' THEN
    IF p_student_id IS DISTINCT FROM auth_student_id() THEN
      RAISE EXCEPTION 'Not authorized: students may only read their own journal';
    END IF;
  ELSIF v_role = 'teacher' THEN
    IF NOT auth_teacher_has_student(p_student_id) THEN
      RAISE EXCEPTION 'Not authorized: no teaching relationship with this student';
    END IF;
  ELSIF is_admin_or_owner() THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Not authorized to view this journal';
  END IF;

  WITH
  student_row AS (
    SELECT s.id, p.full_name, s.target_exam, s.target_subject
    FROM students s JOIN profiles p ON p.id = s.profile_id
    WHERE s.id = p_student_id
  ),
  my_groups AS (
    SELECT gs.group_id, g.name AS group_name
    FROM group_students gs JOIN groups g ON g.id = gs.group_id
    WHERE gs.student_id = p_student_id
  ),
  -- Canonical subject mapping: courses.subject is the closed enum {physics, math};
  -- task_collections.subject stores the same two subjects as Russian labels
  -- (Физика/Математика — matching SUBJECT_LABELS already used in the frontend).
  -- This is a fixed 1:1 mapping over a known, closed two-value domain, not a guess
  -- from free text. Individual lessons (no group_id) have no subject source at all
  -- and are deliberately excluded when a subject filter is active.
  raw_lessons AS (
    SELECT l.*,
      CASE WHEN l.group_id IS NOT NULL THEN
        (SELECT CASE c.subject::text WHEN 'physics' THEN 'Физика' WHEN 'math' THEN 'Математика' ELSE NULL END
         FROM groups g JOIN courses c ON c.id = g.course_id WHERE g.id = l.group_id)
      ELSE NULL END AS subject_label
    FROM lessons l
    WHERE (l.student_id = (SELECT profile_id FROM students WHERE id = p_student_id) OR l.group_id IN (SELECT group_id FROM my_groups))
      AND (p_date_from IS NULL OR l.scheduled_at >= p_date_from)
      AND (p_date_to   IS NULL OR l.scheduled_at <= p_date_to)
  ),
  scoped_lessons AS (
    SELECT * FROM raw_lessons
    WHERE p_subject IS NULL OR subject_label = p_subject
  ),
  lesson_att AS (SELECT a.lesson_id, a.status, a.note FROM attendance a WHERE a.student_id = p_student_id),
  scoped_assignments AS (
    SELECT ac.*, m.student_id AS member_student_id, tc.subject AS collection_subject
    FROM assigned_collections ac
    JOIN assigned_collection_members m ON m.assigned_id = ac.id
    JOIN task_collections tc ON tc.id = ac.collection_id
    WHERE m.student_id = p_student_id
      AND (p_date_from IS NULL OR ac.created_at >= p_date_from)
      AND (p_date_to   IS NULL OR ac.created_at <= p_date_to)
      AND (p_subject IS NULL OR tc.subject = p_subject)
  ),
  own_submissions AS (SELECT ts.* FROM task_submissions ts WHERE ts.student_id = p_student_id),
  lessons_json AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', sl.id, 'title', sl.title, 'scheduled_at', sl.scheduled_at,
      'duration_minutes', sl.duration_minutes, 'status', sl.status, 'format', sl.format,
      'group_name', mg.group_name, 'planned_topic', sl.planned_topic, 'actual_topic', sl.actual_topic,
      'lesson_summary', sl.lesson_summary, 'recommendations', sl.recommendations,
      'attendance_status', la.status, 'attendance_note', la.note
    ) ORDER BY sl.scheduled_at DESC) AS data
    FROM scoped_lessons sl LEFT JOIN lesson_att la ON la.lesson_id = sl.id LEFT JOIN my_groups mg ON mg.group_id = sl.group_id
  ),
  assignments_json AS (
    SELECT jsonb_agg(jsonb_build_object(
      'assigned_id', sa.id, 'collection_id', sa.collection_id, 'collection_title', tc.title,
      'lesson_id', sa.lesson_id, 'due_date', sa.due_date, 'created_at', sa.created_at,
      'assignment_status', sa.status, 'submission_id', os.id, 'submission_status', os.status,
      'submitted_at', os.submitted_at, 'reviewed_at', os.reviewed_at, 'score', os.score,
      'teacher_comment', os.teacher_comment
    ) ORDER BY sa.created_at DESC) AS data
    FROM scoped_assignments sa LEFT JOIN task_collections tc ON tc.id = sa.collection_id LEFT JOIN own_submissions os ON os.assigned_id = sa.id
  ),
  -- Attendance: denominator = present + late + absent (completed lessons only).
  -- excused is tracked separately and never counts toward attended or missed —
  -- an excused absence is neither a positive nor a negative attendance signal.
  -- A completed lesson with no attendance row at all is excluded entirely
  -- (no fabricated "missed" when the mark was simply never entered).
  att_calc AS (
    SELECT
      count(*) FILTER (WHERE sl.status = 'completed' AND la.status = 'present') AS present_n,
      count(*) FILTER (WHERE sl.status = 'completed' AND la.status = 'late') AS late_n,
      count(*) FILTER (WHERE sl.status = 'completed' AND la.status = 'absent') AS absent_n,
      count(*) FILTER (WHERE sl.status = 'completed' AND la.status = 'excused') AS excused_n,
      count(*) FILTER (WHERE sl.status = 'completed') AS lessons_completed
    FROM scoped_lessons sl LEFT JOIN lesson_att la ON la.lesson_id = sl.id
  ),
  -- Homework:
  -- overdue = due date passed AND no submission at all yet (never applied once a
  -- submission exists — resubmission overwrites submitted_at, so we cannot claim
  -- the *original* attempt was late; "on time" below is judged only by the
  -- current submitted_at against due_date, not a resubmission history we don't store).
  -- avg_score = only submissions in a reviewed terminal state (accepted/rejected)
  -- with a non-null score — never submitted/returned/not_started, never guessed.
  hw_calc AS (
    SELECT
      count(*) AS assigned_n, count(os.id) AS submitted_ever,
      count(*) FILTER (WHERE os.status = 'accepted') AS accepted_n,
      count(*) FILTER (WHERE os.status = 'returned') AS returned_n,
      count(*) FILTER (WHERE os.status = 'rejected') AS rejected_n,
      count(*) FILTER (WHERE sa.due_date IS NOT NULL AND sa.due_date < now() AND os.id IS NULL) AS overdue_n,
      count(*) FILTER (WHERE sa.due_date IS NOT NULL AND os.submitted_at IS NOT NULL AND os.submitted_at <= sa.due_date) AS on_time_n,
      count(*) FILTER (WHERE sa.due_date IS NOT NULL) AS with_due_date_n,
      avg(os.score) FILTER (WHERE os.score IS NOT NULL AND os.status IN ('accepted', 'rejected')) AS avg_score,
      count(os.score) FILTER (WHERE os.score IS NOT NULL AND os.status IN ('accepted', 'rejected')) AS scored_n
    FROM scoped_assignments sa LEFT JOIN own_submissions os ON os.assigned_id = sa.id
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date AS week_start
    FROM generate_series(date_trunc('week', COALESCE(p_date_from, now() - interval '11 weeks')), date_trunc('week', COALESCE(p_date_to, now())), interval '1 week') d
  ),
  -- Trend must respect the same subject scope as the tables above: "submitted"/"accepted"
  -- counts are joined through scoped_assignments (not all of own_submissions), so a
  -- subject filter narrows the chart exactly like it narrows the homework table.
  trend_json AS (
    SELECT jsonb_agg(jsonb_build_object(
      'week_start', w.week_start,
      'lessons_completed', (SELECT count(*) FROM scoped_lessons sl WHERE sl.status = 'completed' AND date_trunc('week', sl.scheduled_at) = w.week_start),
      'submitted', (SELECT count(*) FROM scoped_assignments sa JOIN own_submissions os ON os.assigned_id = sa.id WHERE date_trunc('week', os.submitted_at) = w.week_start),
      'accepted', (SELECT count(*) FROM scoped_assignments sa JOIN own_submissions os ON os.assigned_id = sa.id WHERE os.status = 'accepted' AND date_trunc('week', os.reviewed_at) = w.week_start)
    ) ORDER BY w.week_start) AS data
    FROM weeks w
  )
  SELECT jsonb_build_object(
    'student', jsonb_build_object('id', sr.id, 'full_name', sr.full_name, 'target_exam', sr.target_exam, 'target_subject', sr.target_subject,
      'groups', (SELECT jsonb_agg(jsonb_build_object('group_id', mg.group_id, 'group_name', mg.group_name)) FROM my_groups mg)),
    'summary', jsonb_build_object(
      'lessons_completed', ac.lessons_completed,
      'present_count', ac.present_n, 'late_count', ac.late_n, 'absent_count', ac.absent_n, 'excused_count', ac.excused_n,
      'attended', ac.present_n + ac.late_n, 'missed', ac.absent_n,
      'attendance_pct', CASE WHEN (ac.present_n + ac.late_n + ac.absent_n) > 0 THEN round(100.0 * (ac.present_n + ac.late_n) / (ac.present_n + ac.late_n + ac.absent_n), 1) ELSE NULL END,
      'hw_assigned', hc.assigned_n, 'hw_submitted_ever', hc.submitted_ever, 'hw_accepted', hc.accepted_n,
      'hw_returned', hc.returned_n, 'hw_rejected', hc.rejected_n, 'hw_overdue', hc.overdue_n,
      'hw_on_time', hc.on_time_n, 'hw_with_due_date', hc.with_due_date_n,
      'avg_score', CASE WHEN hc.scored_n > 0 THEN round(hc.avg_score, 2) ELSE NULL END, 'scored_count', hc.scored_n)
    ,
    'lessons', COALESCE((SELECT data FROM lessons_json), '[]'::jsonb),
    'assignments', COALESCE((SELECT data FROM assignments_json), '[]'::jsonb),
    'trend', COALESCE((SELECT data FROM trend_json), '[]'::jsonb)
  ) INTO v_result
  FROM student_row sr, att_calc ac, hw_calc hc;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_student_journal(uuid, timestamptz, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_student_journal(uuid, timestamptz, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION get_student_journal(uuid, timestamptz, timestamptz, text) TO authenticated;

-- auth_teacher_has_student: real teaching relationship check (individual lesson,
-- own group lesson, or own assigned_collection targeting the student).
CREATE OR REPLACE FUNCTION auth_teacher_has_student(p_student_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_teacher_profile_id uuid := auth.uid();
  v_teacher_row_id uuid;
BEGIN
  SELECT id INTO v_teacher_row_id FROM teachers WHERE profile_id = v_teacher_profile_id;
  IF v_teacher_row_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM lessons l
    WHERE l.teacher_id = v_teacher_row_id
      AND (
        l.student_id = (SELECT profile_id FROM students WHERE id = p_student_id)
        OR l.group_id IN (SELECT gs.group_id FROM group_students gs WHERE gs.student_id = p_student_id)
      )
  ) OR EXISTS (
    SELECT 1 FROM assigned_collections ac
    JOIN assigned_collection_members m ON m.assigned_id = ac.id
    WHERE ac.teacher_id = v_teacher_profile_id AND m.student_id = p_student_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_teacher_has_student(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_teacher_has_student(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION auth_teacher_has_student(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_task_submissions_submitted_at ON task_submissions(submitted_at);
