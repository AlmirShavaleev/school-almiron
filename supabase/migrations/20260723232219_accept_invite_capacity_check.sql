-- Fix: enrollment_invites accept path had no group-capacity re-check.
-- create_student_invite / invite_student_flow only check capacity at issue time
-- (no seat reservation), so multiple invites issued before any is accepted can
-- overflow a group beyond max_students once accepted concurrently or in sequence.
-- This patch adds a FOR UPDATE lock + recheck on the groups row inside
-- _accept_invite_core, right before the group_students insert, raising the
-- same GROUP_ALREADY_FULL error used at issue time. Every other branch
-- (idempotency, expired/accepted/revoked handling, teacher_students dedup,
-- pending-join-request closing) is unchanged.

CREATE OR REPLACE FUNCTION public._accept_invite_core(p_invite_id uuid)
RETURNS TABLE(invite_id uuid, student_id uuid, group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_inv public.enrollment_invites%ROWTYPE;
  v_uid uuid := auth.uid();
  v_role public.user_role;
  v_email text;
  v_student_id uuid;
  v_teacher_id uuid;
  v_max int;
  v_cnt int;
  v_already_member boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_inv FROM public.enrollment_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_inv.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING: %', v_inv.status USING ERRCODE = 'P0001'; END IF;
  IF v_inv.expires_at < now() THEN RAISE EXCEPTION 'INVITE_EXPIRED' USING ERRCODE = 'P0001'; END IF;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = v_uid;
  IF NOT FOUND THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid AND u.email_confirmed_at IS NOT NULL;
    IF v_email IS NULL THEN RAISE EXCEPTION 'EMAIL_NOT_CONFIRMED' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.profiles (id, email, full_name, role) VALUES (v_uid, v_email, v_inv.full_name, 'student');
  ELSIF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'PROFILE_ROLE_NOT_STUDENT: %', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT s.id INTO v_student_id FROM public.students s WHERE s.profile_id = v_uid;
  IF v_student_id IS NULL THEN RAISE EXCEPTION 'STUDENT_RECORD_MISSING' USING ERRCODE = 'P0001'; END IF;

  SELECT t.id INTO v_teacher_id FROM public.teachers t WHERE t.profile_id = v_inv.invited_by;
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'INVITER_NOT_A_TEACHER' USING ERRCODE = 'P0001'; END IF;

  -- capacity re-check at accept time: lock the group row so concurrent accepts
  -- serialize on it, then compare against the live member count. Skip the
  -- check entirely if the student is already a member (idempotent re-accept).
  SELECT max_students INTO v_max FROM public.groups WHERE id = v_inv.group_id FOR UPDATE;
  IF v_max IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.group_students WHERE group_id = v_inv.group_id AND student_id = v_student_id
    ) INTO v_already_member;
    IF NOT v_already_member THEN
      SELECT count(*) INTO v_cnt FROM public.group_students WHERE group_id = v_inv.group_id;
      IF v_cnt >= v_max THEN
        RAISE EXCEPTION 'GROUP_ALREADY_FULL: % / % мест', v_cnt, v_max USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.teacher_students AS ts (teacher_id, student_id, source_invite_id)
  VALUES (v_teacher_id, v_student_id, v_inv.id)
  ON CONFLICT ON CONSTRAINT teacher_students_teacher_id_student_id_key
  DO UPDATE SET status = 'active', updated_at = now();

  INSERT INTO public.group_students AS gs (group_id, student_id)
  VALUES (v_inv.group_id, v_student_id)
  ON CONFLICT ON CONSTRAINT group_students_group_id_student_id_key DO NOTHING;

  UPDATE public.enrollment_invites SET status = 'accepted', accepted_by = v_uid, accepted_at = now(), updated_at = now()
  WHERE id = v_inv.id;

  -- additive: close a pending join request to this same teacher, if any
  UPDATE public.teacher_join_requests jr
  SET status = 'approved', reviewed_at = now()
  WHERE jr.teacher_id = v_teacher_id AND jr.student_id = v_student_id AND jr.status = 'pending';

  RETURN QUERY SELECT v_inv.id, v_student_id, v_inv.group_id;
END; $$;
REVOKE ALL ON FUNCTION public._accept_invite_core(uuid) FROM PUBLIC, anon, authenticated;
