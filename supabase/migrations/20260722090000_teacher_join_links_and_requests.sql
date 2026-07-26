-- Stage 1 of the new onboarding flow: permanent teacher registration link + join requests.
-- teacher_students remains active/archived only (unchanged). Requests live in a separate
-- entity: join request = pre-acceptance application, teacher_students = established link.
-- student_courses is untouched; real course access stays group_students -> groups.course_id.
-- The existing group-bound invite flow (enrollment_invites / create_student_invite /
-- accept_student_invite / invite_student_flow) is not modified except for one additive
-- statement in _accept_invite_core (see bottom) that closes a pending join request when the
-- student is connected via the old direct-invite path instead.

CREATE TABLE public.teacher_join_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  rotated_from_id uuid REFERENCES public.teacher_join_links(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX teacher_join_links_one_active_uq ON public.teacher_join_links (teacher_id) WHERE is_active;

CREATE TABLE public.teacher_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  join_link_id uuid NOT NULL REFERENCES public.teacher_join_links(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  UNIQUE (teacher_id, student_id)
);
CREATE INDEX teacher_join_requests_teacher_idx ON public.teacher_join_requests(teacher_id);
CREATE INDEX teacher_join_requests_student_idx ON public.teacher_join_requests(student_id);

ALTER TABLE public.teacher_join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY teacher_join_links_select_own ON public.teacher_join_links
  FOR SELECT USING (public.is_admin_or_owner() OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_join_links.teacher_id AND t.profile_id = auth.uid()));
CREATE POLICY teacher_join_links_admin_all ON public.teacher_join_links
  FOR ALL USING (public.is_admin_or_owner());

CREATE POLICY teacher_join_requests_select_own ON public.teacher_join_requests
  FOR SELECT USING (public.is_admin_or_owner() OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_join_requests.teacher_id AND t.profile_id = auth.uid()));
CREATE POLICY teacher_join_requests_admin_all ON public.teacher_join_requests
  FOR ALL USING (public.is_admin_or_owner());

-- No table-level grants to anon/authenticated at all: every read/write goes through the
-- SECURITY DEFINER RPCs below (same pattern as enrollment_invites / teacher_students).
REVOKE ALL ON public.teacher_join_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.teacher_join_requests FROM PUBLIC, anon, authenticated;

-- ---------- helpers ----------

CREATE OR REPLACE FUNCTION public._current_teacher_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM public.teachers WHERE profile_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public._current_teacher_id() FROM PUBLIC, anon, authenticated;

-- ---------- link management (teacher only) ----------

-- Returns the current active link's metadata. Creates one if none exists (raw token
-- returned only in that case). If an active link already exists, token is NULL --
-- the plaintext is never re-derivable from the stored hash, matching the same
-- "shown once" contract used by enrollment_invites tokens/short codes.
CREATE OR REPLACE FUNCTION public.create_or_get_teacher_join_link()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_teacher_id uuid := public._current_teacher_id();
  v_existing public.teacher_join_links%ROWTYPE;
  v_raw text;
  v_hash text;
  v_id uuid;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'ONLY_TEACHER_HAS_JOIN_LINK' USING ERRCODE = 'P0001';
  END IF;
  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'TEACHER_ROW_MISSING' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing FROM public.teacher_join_links WHERE teacher_id = v_teacher_id AND is_active LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('link_id', v_existing.id, 'is_new', false, 'token', NULL, 'created_at', v_existing.created_at);
  END IF;

  v_raw := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  INSERT INTO public.teacher_join_links (teacher_id, token_hash) VALUES (v_teacher_id, v_hash) RETURNING id INTO v_id;

  RETURN jsonb_build_object('link_id', v_id, 'is_new', true, 'token', v_raw, 'created_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.create_or_get_teacher_join_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_get_teacher_join_link() TO authenticated;

-- Revokes the current active link (if any) and issues a fresh one. Old token stops working
-- immediately (is_active=false), independent of the new row.
CREATE OR REPLACE FUNCTION public.rotate_teacher_join_link()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_teacher_id uuid := public._current_teacher_id();
  v_old_id uuid;
  v_raw text;
  v_hash text;
  v_id uuid;
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'ONLY_TEACHER_HAS_JOIN_LINK' USING ERRCODE = 'P0001';
  END IF;
  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'TEACHER_ROW_MISSING' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_old_id FROM public.teacher_join_links WHERE teacher_id = v_teacher_id AND is_active LIMIT 1;
  IF v_old_id IS NOT NULL THEN
    UPDATE public.teacher_join_links SET is_active = false, revoked_at = now() WHERE id = v_old_id;
  END IF;

  v_raw := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  INSERT INTO public.teacher_join_links (teacher_id, token_hash, rotated_from_id)
  VALUES (v_teacher_id, v_hash, v_old_id) RETURNING id INTO v_id;

  RETURN jsonb_build_object('link_id', v_id, 'is_new', true, 'token', v_raw, 'created_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.rotate_teacher_join_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_teacher_join_link() TO authenticated;

CREATE OR REPLACE FUNCTION public.disable_teacher_join_link()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_teacher_id uuid := public._current_teacher_id();
BEGIN
  IF v_teacher_id IS NULL THEN RAISE EXCEPTION 'TEACHER_ROW_MISSING' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.teacher_join_links SET is_active = false, revoked_at = now()
  WHERE teacher_id = v_teacher_id AND is_active;
END; $$;
REVOKE ALL ON FUNCTION public.disable_teacher_join_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disable_teacher_join_link() TO authenticated;

-- ---------- join request lifecycle ----------

-- Student-side: submit a join request against a teacher's active link. Never creates
-- teacher_students, groups or group_students -- no course access is granted here.
CREATE OR REPLACE FUNCTION public.submit_teacher_join_request(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hash text;
  v_link public.teacher_join_links%ROWTYPE;
  v_role public.user_role;
  v_student_id uuid;
  v_existing_ts_status text;
  v_existing_req public.teacher_join_requests%ROWTYPE;
  v_req_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF btrim(coalesce(p_token,'')) = '' THEN RAISE EXCEPTION 'INVALID_LINK' USING ERRCODE = 'P0001'; END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  SELECT * INTO v_link FROM public.teacher_join_links WHERE token_hash = v_hash AND is_active LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'LINK_INVALID_OR_INACTIVE' USING ERRCODE = 'P0001'; END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROFILE_MISSING' USING ERRCODE = 'P0001'; END IF;
  IF v_role IS DISTINCT FROM 'student' THEN
    RAISE EXCEPTION 'ONLY_STUDENT_CAN_JOIN: %', v_role USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_student_id FROM public.students WHERE profile_id = v_uid;
  IF v_student_id IS NULL THEN RAISE EXCEPTION 'STUDENT_RECORD_MISSING' USING ERRCODE = 'P0001'; END IF;

  SELECT status INTO v_existing_ts_status FROM public.teacher_students WHERE teacher_id = v_link.teacher_id AND student_id = v_student_id;
  IF v_existing_ts_status = 'active' THEN
    RAISE EXCEPTION 'ALREADY_CONNECTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_req FROM public.teacher_join_requests WHERE teacher_id = v_link.teacher_id AND student_id = v_student_id;
  IF FOUND THEN
    IF v_existing_req.status = 'pending' THEN
      RETURN jsonb_build_object('request_id', v_existing_req.id, 'status', 'pending', 'created_at', v_existing_req.created_at);
    ELSIF v_existing_req.status = 'approved' THEN
      RAISE EXCEPTION 'ALREADY_CONNECTED' USING ERRCODE = 'P0001';
    ELSIF v_existing_req.status = 'rejected' THEN
      RAISE EXCEPTION 'REQUEST_REJECTED' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'REQUEST_CANCELLED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.teacher_join_requests (teacher_id, student_id, join_link_id, status)
  VALUES (v_link.teacher_id, v_student_id, v_link.id, 'pending')
  RETURNING id INTO v_req_id;

  RETURN jsonb_build_object('request_id', v_req_id, 'status', 'pending', 'created_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.submit_teacher_join_request(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_teacher_join_request(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_teacher_join_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req public.teacher_join_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.teacher_join_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF NOT (public.is_admin_or_owner() OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = v_req.teacher_id AND t.profile_id = auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING: %', v_req.status USING ERRCODE = 'P0001'; END IF;
  UPDATE public.teacher_join_requests SET status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid() WHERE id = p_request_id;
END; $$;
REVOKE ALL ON FUNCTION public.reject_teacher_join_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_teacher_join_request(uuid) TO authenticated;

-- "Вернуть в новые": rejected -> pending again. Only the reviewing teacher/admin can do this
-- (a student can never self-restore a rejected request).
CREATE OR REPLACE FUNCTION public.restore_teacher_join_request(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_req public.teacher_join_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_req FROM public.teacher_join_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF NOT (public.is_admin_or_owner() OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = v_req.teacher_id AND t.profile_id = auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  IF v_req.status <> 'rejected' THEN RAISE EXCEPTION 'REQUEST_NOT_REJECTED: %', v_req.status USING ERRCODE = 'P0001'; END IF;
  UPDATE public.teacher_join_requests SET status = 'pending', reviewed_at = NULL, reviewed_by = NULL WHERE id = p_request_id;
END; $$;
REVOKE ALL ON FUNCTION public.restore_teacher_join_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_teacher_join_request(uuid) TO authenticated;

-- Minimal read helper for the "Новые ученики" UI (same pattern as get_my_students /
-- get_my_student_invites: SECURITY DEFINER, filtered to the caller's own teacher_id).
CREATE OR REPLACE FUNCTION public.get_my_join_requests(p_status text DEFAULT NULL)
RETURNS TABLE(id uuid, student_id uuid, full_name text, email text, status text, created_at timestamptz, reviewed_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r.id, r.student_id, p.full_name, p.email, r.status, r.created_at, r.reviewed_at
  FROM public.teacher_join_requests r
  JOIN public.students s ON s.id = r.student_id
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE (r.teacher_id = public._current_teacher_id() OR public.is_admin_or_owner())
    AND (p_status IS NULL OR r.status = p_status)
  ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_my_join_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_join_requests(text) TO authenticated;

-- ---------- minimal, additive patch to the existing direct-invite accept path ----------
-- If a student had a pending join request to this same teacher and then gets connected via
-- the old group-bound invite instead, the pending request must be closed as approved so it
-- doesn't linger forever and so stage-2 distribution doesn't see a stale duplicate. This is
-- the only change to _accept_invite_core; every other branch/behavior is untouched.
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

  INSERT INTO public.teacher_students AS ts (teacher_id, student_id, source_invite_id)
  VALUES (v_teacher_id, v_student_id, v_inv.id)
  ON CONFLICT ON CONSTRAINT teacher_students_teacher_id_student_id_key
  DO UPDATE SET status = 'active', updated_at = now();

  INSERT INTO public.group_students AS gs (group_id, student_id)
  VALUES (v_inv.group_id, v_student_id)
  ON CONFLICT ON CONSTRAINT group_students_group_id_student_id_key DO NOTHING;

  UPDATE public.enrollment_invites SET status = 'accepted', accepted_by = v_uid, accepted_at = now(), updated_at = now()
  WHERE id = v_inv.id;

  -- additive: close a pending join request to this same teacher, if any (see comment above)
  UPDATE public.teacher_join_requests jr
  SET status = 'approved', reviewed_at = now()
  WHERE jr.teacher_id = v_teacher_id AND jr.student_id = v_student_id AND jr.status = 'pending';

  RETURN QUERY SELECT v_inv.id, v_student_id, v_inv.group_id;
END; $$;
REVOKE ALL ON FUNCTION public._accept_invite_core(uuid) FROM PUBLIC, anon, authenticated;
