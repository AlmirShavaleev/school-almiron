-- Fix: 'groups' jsonb_agg returns SQL NULL (not '[]') when student has no group memberships,
-- crashing frontend `student.groups.map()`. All other array fields already COALESCE to '[]'.
CREATE OR REPLACE FUNCTION get_student_journal(
  p_student_id uuid,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_subject text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE v_role text; v_result jsonb;
BEGIN
  IF p_student_id IS NULL THEN RAISE EXCEPTION 'p_student_id is required'; END IF;
  IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid period: date_from is after date_to';
  END IF;
  v_role := get_my_role();
  IF v_role = 'student' THEN
    IF p_student_id IS DISTINCT FROM auth_student_id() THEN RAISE EXCEPTION 'Not authorized: students may only read their own journal'; END IF;
  ELSIF v_role = 'teacher' THEN
    IF NOT auth_teacher_has_student(p_student_id) THEN RAISE EXCEPTION 'Not authorized: no teaching relationship with this student'; END IF;
  ELSIF is_admin_or_owner() THEN NULL;
  ELSE RAISE EXCEPTION 'Not authorized to view this journal';
  END IF;

  WITH
  student_row AS (
    SELECT s.id, p.full_name, s.target_exam, s.target_subject
    FROM students s JOIN profiles p ON p.id = s.profile_id WHERE s.id = p_student_id
  ),
  my_groups AS (
    SELECT gs.group_id, g.name group_name, g.course_id
    FROM group_students gs JOIN groups g ON g.id = gs.group_id WHERE gs.student_id = p_student_id
  ),
  raw_lessons AS (
    SELECT l.*, CASE WHEN l.group_id IS NOT NULL THEN
      (SELECT CASE c.subject::text WHEN 'physics' THEN 'Физика' WHEN 'math' THEN 'Математика' END
       FROM groups g JOIN courses c ON c.id = g.course_id WHERE g.id = l.group_id) END subject_label
    FROM lessons l
    WHERE (l.student_id = (SELECT profile_id FROM students WHERE id = p_student_id) OR l.group_id IN (SELECT group_id FROM my_groups))
      AND (p_date_from IS NULL OR l.scheduled_at >= p_date_from)
      AND (p_date_to IS NULL OR l.scheduled_at <= p_date_to)
  ),
  scoped_lessons AS (SELECT * FROM raw_lessons WHERE p_subject IS NULL OR subject_label = p_subject),
  lesson_att AS (SELECT a.lesson_id, a.status, a.note FROM attendance a WHERE a.student_id = p_student_id),
  collection_rows AS (
    SELECT
      'collection'::text source, ac.id assigned_id, ac.collection_id, tc.title collection_title,
      ac.lesson_id, l.topic_id, ac.due_date, ac.created_at, ac.status::text assignment_status,
      ts.id submission_id,
      CASE ts.status::text WHEN 'submitted' THEN 'submitted' WHEN 'returned' THEN 'returned'
        WHEN 'accepted' THEN 'accepted' WHEN 'rejected' THEN 'rejected' ELSE NULL END submission_status,
      ts.submitted_at, ts.reviewed_at, ts.score, NULL::numeric max_score, ts.teacher_comment,
      tc.subject collection_subject
    FROM assigned_collections ac
    JOIN assigned_collection_members m ON m.assigned_id = ac.id AND m.student_id = p_student_id
    JOIN task_collections tc ON tc.id = ac.collection_id
    LEFT JOIN task_submissions ts ON ts.assigned_id = ac.id AND ts.student_id = p_student_id
    LEFT JOIN lessons l ON l.id = ac.lesson_id
    WHERE (p_date_from IS NULL OR ac.created_at >= p_date_from)
      AND (p_date_to IS NULL OR ac.created_at <= p_date_to)
      AND (p_subject IS NULL OR tc.subject = p_subject)
  ),
  legacy_rows AS (
    SELECT
      'legacy'::text source, h.id assigned_id, NULL::uuid collection_id, h.title collection_title,
      h.lesson_id, h.topic_id, h.due_date, h.created_at, 'active'::text assignment_status,
      hs.id submission_id,
      CASE hs.status::text
        WHEN 'submitted' THEN 'submitted' WHEN 'under_review' THEN 'submitted' WHEN 'resubmitted' THEN 'submitted'
        WHEN 'revision' THEN 'returned' WHEN 'revision_requested' THEN 'returned'
        WHEN 'checked' THEN 'accepted' WHEN 'accepted' THEN 'accepted' ELSE NULL END submission_status,
      hs.submitted_at, hs.checked_at reviewed_at, hs.score::numeric score, h.max_score::numeric max_score,
      hs.feedback teacher_comment,
      CASE c.subject::text WHEN 'physics' THEN 'Физика' WHEN 'math' THEN 'Математика' END collection_subject
    FROM homeworks h
    JOIN topics t ON t.id = h.topic_id JOIN modules mo ON mo.id = t.module_id JOIN courses c ON c.id = mo.course_id
    LEFT JOIN homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = p_student_id
    WHERE mo.course_id IN (SELECT course_id FROM my_groups)
      AND (p_date_from IS NULL OR h.created_at >= p_date_from)
      AND (p_date_to IS NULL OR h.created_at <= p_date_to)
      AND (p_subject IS NULL OR CASE c.subject::text WHEN 'physics' THEN 'Физика' WHEN 'math' THEN 'Математика' END = p_subject)
  ),
  unified_rows AS (SELECT * FROM collection_rows UNION ALL SELECT * FROM legacy_rows),
  lessons_json AS (
    SELECT jsonb_agg(jsonb_build_object(
      'id', sl.id, 'title', sl.title, 'scheduled_at', sl.scheduled_at, 'duration_minutes', sl.duration_minutes,
      'status', sl.status, 'format', sl.format, 'group_name', mg.group_name, 'planned_topic', sl.planned_topic,
      'actual_topic', sl.actual_topic, 'lesson_summary', sl.lesson_summary, 'recommendations', sl.recommendations,
      'attendance_status', la.status, 'attendance_note', la.note) ORDER BY sl.scheduled_at DESC) data
    FROM scoped_lessons sl LEFT JOIN lesson_att la ON la.lesson_id = sl.id LEFT JOIN my_groups mg ON mg.group_id = sl.group_id
  ),
  assignments_json AS (
    SELECT jsonb_agg(jsonb_build_object(
      'source', u.source, 'assigned_id', u.assigned_id, 'collection_id', u.collection_id,
      'collection_title', u.collection_title, 'lesson_id', u.lesson_id, 'topic_id', u.topic_id,
      'due_date', u.due_date, 'created_at', u.created_at, 'assignment_status', u.assignment_status,
      'submission_id', u.submission_id, 'submission_status', u.submission_status,
      'submitted_at', u.submitted_at, 'reviewed_at', u.reviewed_at, 'score', u.score,
      'max_score', u.max_score, 'teacher_comment', u.teacher_comment) ORDER BY u.created_at DESC) data
    FROM unified_rows u
  ),
  att_calc AS (
    SELECT count(*) FILTER (WHERE sl.status='completed' AND la.status='present') present_n,
      count(*) FILTER (WHERE sl.status='completed' AND la.status='late') late_n,
      count(*) FILTER (WHERE sl.status='completed' AND la.status='absent') absent_n,
      count(*) FILTER (WHERE sl.status='completed' AND la.status='excused') excused_n,
      count(*) FILTER (WHERE sl.status='completed') lessons_completed
    FROM scoped_lessons sl LEFT JOIN lesson_att la ON la.lesson_id=sl.id
  ),
  hw_calc AS (
    SELECT count(*) assigned_n, count(submission_id) submitted_ever,
      count(*) FILTER (WHERE submission_status='accepted') accepted_n,
      count(*) FILTER (WHERE submission_status='returned') returned_n,
      count(*) FILTER (WHERE submission_status='rejected') rejected_n,
      count(*) FILTER (WHERE due_date IS NOT NULL AND due_date < now() AND submission_id IS NULL) overdue_n,
      count(*) FILTER (WHERE due_date IS NOT NULL AND submitted_at IS NOT NULL AND submitted_at <= due_date) on_time_n,
      count(*) FILTER (WHERE due_date IS NOT NULL) with_due_date_n,
      avg(score) FILTER (WHERE source='collection' AND score IS NOT NULL AND submission_status IN ('accepted','rejected')) avg_score,
      count(score) FILTER (WHERE source='collection' AND score IS NOT NULL AND submission_status IN ('accepted','rejected')) scored_n
    FROM unified_rows
  ),
  weeks AS (
    SELECT date_trunc('week', d)::date week_start FROM generate_series(
      date_trunc('week', COALESCE(p_date_from, now()-interval '11 weeks')),
      date_trunc('week', COALESCE(p_date_to, now())), interval '1 week') d
  ),
  trend_json AS (
    SELECT jsonb_agg(jsonb_build_object('week_start',w.week_start,
      'lessons_completed',(SELECT count(*) FROM scoped_lessons sl WHERE sl.status='completed' AND date_trunc('week',sl.scheduled_at)=w.week_start),
      'submitted',(SELECT count(*) FROM unified_rows u WHERE date_trunc('week',u.submitted_at)=w.week_start),
      'accepted',(SELECT count(*) FROM unified_rows u WHERE u.submission_status='accepted' AND date_trunc('week',u.reviewed_at)=w.week_start)) ORDER BY w.week_start) data
    FROM weeks w
  )
  SELECT jsonb_build_object(
    'student',jsonb_build_object('id',sr.id,'full_name',sr.full_name,'target_exam',sr.target_exam,'target_subject',sr.target_subject,
      'groups',COALESCE((SELECT jsonb_agg(jsonb_build_object('group_id',mg.group_id,'group_name',mg.group_name)) FROM my_groups mg),'[]'::jsonb)),
    'summary',jsonb_build_object('lessons_completed',ac.lessons_completed,'present_count',ac.present_n,'late_count',ac.late_n,
      'absent_count',ac.absent_n,'excused_count',ac.excused_n,'attended',ac.present_n+ac.late_n,'missed',ac.absent_n,
      'attendance_pct',CASE WHEN ac.present_n+ac.late_n+ac.absent_n>0 THEN round(100.0*(ac.present_n+ac.late_n)/(ac.present_n+ac.late_n+ac.absent_n),1) END,
      'hw_assigned',hc.assigned_n,'hw_submitted_ever',hc.submitted_ever,'hw_accepted',hc.accepted_n,'hw_returned',hc.returned_n,
      'hw_rejected',hc.rejected_n,'hw_overdue',hc.overdue_n,'hw_on_time',hc.on_time_n,'hw_with_due_date',hc.with_due_date_n,
      'avg_score',CASE WHEN hc.scored_n>0 THEN round(hc.avg_score,2) END,'scored_count',hc.scored_n),
    'lessons',COALESCE((SELECT data FROM lessons_json),'[]'::jsonb),
    'assignments',COALESCE((SELECT data FROM assignments_json),'[]'::jsonb),
    'trend',COALESCE((SELECT data FROM trend_json),'[]'::jsonb)) INTO v_result
  FROM student_row sr, att_calc ac, hw_calc hc;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_student_journal(uuid,timestamptz,timestamptz,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_student_journal(uuid,timestamptz,timestamptz,text) FROM anon;
GRANT EXECUTE ON FUNCTION get_student_journal(uuid,timestamptz,timestamptz,text) TO authenticated;
