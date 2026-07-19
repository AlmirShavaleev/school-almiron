CREATE OR REPLACE FUNCTION public.normalize_email(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(lower(trim(p)), '') $$;

CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(regexp_replace(trim(p), '[^0-9+]', '', 'g'), '') $$;

CREATE OR REPLACE FUNCTION public.normalize_short_code(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(upper(regexp_replace(trim(p), '[^0-9A-Za-z]', '', 'g')), '') $$;

CREATE TABLE public.enrollment_invite_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  title text, rows_count int NOT NULL CHECK (rows_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.enrollment_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES public.profiles(id),
  batch_id uuid REFERENCES public.enrollment_invite_batches(id) ON DELETE SET NULL,
  client_row_id text,
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  email text, phone text,
  email_normalized text GENERATED ALWAYS AS (public.normalize_email(email)) STORED,
  phone_normalized text GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED,
  class_grade text,
  token_hash text NOT NULL UNIQUE,
  short_code_hash text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_by uuid REFERENCES public.profiles(id),
  accepted_at timestamptz, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX enrollment_invites_active_email_uq ON public.enrollment_invites (invited_by, group_id, email_normalized) WHERE status = 'pending' AND email_normalized IS NOT NULL;
CREATE UNIQUE INDEX enrollment_invites_active_phone_uq ON public.enrollment_invites (invited_by, group_id, phone_normalized) WHERE status = 'pending' AND phone_normalized IS NOT NULL;
CREATE UNIQUE INDEX enrollment_invites_batch_row_uq ON public.enrollment_invites (batch_id, client_row_id) WHERE batch_id IS NOT NULL;
CREATE INDEX enrollment_invites_invited_by_idx ON public.enrollment_invites(invited_by);
CREATE INDEX enrollment_invites_group_idx ON public.enrollment_invites(group_id);

CREATE TABLE public.teacher_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  source_invite_id uuid REFERENCES public.enrollment_invites(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, student_id)
);

CREATE TRIGGER enrollment_invites_updated_at BEFORE UPDATE ON public.enrollment_invites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER teacher_students_updated_at BEFORE UPDATE ON public.teacher_students FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.enrollment_invite_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollment_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_students ENABLE ROW LEVEL SECURITY;

CREATE POLICY batches_select_own ON public.enrollment_invite_batches FOR SELECT USING (invited_by = auth.uid() OR public.is_admin_or_owner());
CREATE POLICY batches_admin_all ON public.enrollment_invite_batches FOR ALL USING (public.is_admin_or_owner());
CREATE POLICY invites_select_own ON public.enrollment_invites FOR SELECT USING (invited_by = auth.uid() OR public.is_admin_or_owner());
CREATE POLICY invites_admin_all ON public.enrollment_invites FOR ALL USING (public.is_admin_or_owner());
CREATE POLICY teacher_students_select_own ON public.teacher_students FOR SELECT USING (
  public.is_admin_or_owner() OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_students.teacher_id AND t.profile_id = auth.uid())
);
CREATE POLICY teacher_students_admin_all ON public.teacher_students FOR ALL USING (public.is_admin_or_owner());

REVOKE ALL ON public.enrollment_invite_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.enrollment_invites        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.teacher_students          FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._random_base32(n int)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public, extensions, pg_temp AS $$
  SELECT string_agg(substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', (get_byte(gen_random_bytes(1),0) % 32) + 1, 1), '')
  FROM generate_series(1, n)
$$;
REVOKE ALL ON FUNCTION public._random_base32(int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._gen_invite_token()
RETURNS TABLE(raw_token text, token_hash text)
LANGUAGE sql VOLATILE SET search_path = public, extensions, pg_temp AS $$
  SELECT t, encode(digest(t, 'sha256'), 'hex') FROM (SELECT encode(gen_random_bytes(32), 'hex') AS t) s
$$;
REVOKE ALL ON FUNCTION public._gen_invite_token() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._gen_short_code()
RETURNS TABLE(raw_code text, code_hash text)
LANGUAGE sql VOLATILE SET search_path = public, extensions, pg_temp AS $$
  SELECT c, encode(digest(c, 'sha256'), 'hex') FROM (SELECT public._random_base32(10) AS c) s
$$;
REVOKE ALL ON FUNCTION public._gen_short_code() FROM PUBLIC, anon, authenticated;

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

  RETURN QUERY SELECT v_inv.id, v_student_id, v_inv.group_id;
END; $$;
REVOKE ALL ON FUNCTION public._accept_invite_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_student_invite(
  p_group_id uuid, p_full_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_class_grade text DEFAULT NULL
) RETURNS TABLE(invite_id uuid, token text, short_code text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_has_course boolean;
  v_email_n text := public.normalize_email(p_email);
  v_phone_n text := public.normalize_phone(p_phone);
  v_tok RECORD; v_code RECORD; v_id uuid; v_expires timestamptz;
BEGIN
  IF btrim(coalesce(p_full_name,'')) = '' THEN RAISE EXCEPTION 'INVALID_DATA: full_name required' USING ERRCODE = 'P0001'; END IF;
  IF NOT (public.is_admin_or_owner() OR public.auth_is_teacher_of_group(p_group_id)) THEN RAISE EXCEPTION 'FORBIDDEN: not your group' USING ERRCODE = 'P0001'; END IF;
  SELECT (course_id IS NOT NULL) INTO v_has_course FROM public.groups WHERE id = p_group_id;
  IF v_has_course IS NOT TRUE THEN RAISE EXCEPTION 'GROUP_HAS_NO_COURSE' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.enrollment_invites
    WHERE invited_by = auth.uid() AND group_id = p_group_id AND status = 'pending'
      AND ((v_email_n IS NOT NULL AND email_normalized = v_email_n) OR (v_phone_n IS NOT NULL AND phone_normalized = v_phone_n))
  ) THEN RAISE EXCEPTION 'ACTIVE_INVITE_EXISTS' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_tok FROM public._gen_invite_token();
  SELECT * INTO v_code FROM public._gen_short_code();
  v_expires := now() + interval '14 days';
  INSERT INTO public.enrollment_invites (group_id, invited_by, full_name, email, phone, class_grade, token_hash, short_code_hash, expires_at)
  VALUES (p_group_id, auth.uid(), p_full_name, p_email, p_phone, p_class_grade, v_tok.token_hash, v_code.code_hash, v_expires)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_tok.raw_token, v_code.raw_code, v_expires;
END; $$;
REVOKE ALL ON FUNCTION public.create_student_invite(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_student_invite(uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_student_invite_batch(
  p_group_id uuid, p_rows jsonb, p_title text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_has_course boolean; v_batch_id uuid; v_row jsonb; v_row_count int;
  r_client_row_id text; r_full_name text; r_email text; r_phone text; r_class_grade text;
  v_email_n text; v_phone_n text; v_existing_id uuid; v_tok RECORD; v_code RECORD; v_new_id uuid;
  v_items jsonb := '[]'::jsonb; v_item jsonb;
BEGIN
  IF NOT (public.is_admin_or_owner() OR public.auth_is_teacher_of_group(p_group_id)) THEN RAISE EXCEPTION 'FORBIDDEN: not your group' USING ERRCODE = 'P0001'; END IF;
  SELECT (course_id IS NOT NULL) INTO v_has_course FROM public.groups WHERE id = p_group_id;
  IF v_has_course IS NOT TRUE THEN RAISE EXCEPTION 'GROUP_HAS_NO_COURSE' USING ERRCODE = 'P0001'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_DATA: p_rows must be a json array' USING ERRCODE = 'P0001'; END IF;
  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count > 500 THEN RAISE EXCEPTION 'BATCH_TOO_LARGE: max 500 rows, got %', v_row_count USING ERRCODE = 'P0001'; END IF;

  INSERT INTO public.enrollment_invite_batches (group_id, invited_by, title, rows_count)
  VALUES (p_group_id, auth.uid(), p_title, v_row_count) RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    BEGIN
      r_client_row_id := v_row->>'client_row_id'; r_full_name := v_row->>'full_name';
      r_email := v_row->>'email'; r_phone := v_row->>'phone'; r_class_grade := v_row->>'class_grade';

      IF r_client_row_id IS NULL OR btrim(r_client_row_id) = '' THEN
        v_item := jsonb_build_object('client_row_id', coalesce(r_client_row_id,''), 'invite_id', NULL, 'status','invalid_data','token',NULL,'short_code',NULL,'error','client_row_id required');
        v_items := v_items || v_item; CONTINUE;
      END IF;

      SELECT ei.id INTO v_existing_id FROM public.enrollment_invites ei WHERE ei.batch_id = v_batch_id AND ei.client_row_id = r_client_row_id;
      IF v_existing_id IS NOT NULL THEN
        v_item := jsonb_build_object('client_row_id', r_client_row_id, 'invite_id', v_existing_id, 'status','invite_created','token',NULL,'short_code',NULL,'error',NULL);
        v_items := v_items || v_item; CONTINUE;
      END IF;

      IF btrim(coalesce(r_full_name,'')) = '' THEN
        v_item := jsonb_build_object('client_row_id', r_client_row_id, 'invite_id', NULL, 'status','invalid_data','token',NULL,'short_code',NULL,'error','full_name required');
        v_items := v_items || v_item; CONTINUE;
      END IF;

      v_email_n := public.normalize_email(r_email); v_phone_n := public.normalize_phone(r_phone);

      IF EXISTS (SELECT 1 FROM public.enrollment_invites ei WHERE ei.batch_id = v_batch_id AND ((v_email_n IS NOT NULL AND ei.email_normalized = v_email_n) OR (v_phone_n IS NOT NULL AND ei.phone_normalized = v_phone_n))) THEN
        v_item := jsonb_build_object('client_row_id', r_client_row_id, 'invite_id', NULL, 'status','duplicate_in_batch','token',NULL,'short_code',NULL,'error',NULL);
        v_items := v_items || v_item; CONTINUE;
      END IF;

      IF EXISTS (SELECT 1 FROM public.enrollment_invites ei WHERE ei.invited_by = auth.uid() AND ei.group_id = p_group_id AND ei.status = 'pending' AND ((v_email_n IS NOT NULL AND ei.email_normalized = v_email_n) OR (v_phone_n IS NOT NULL AND ei.phone_normalized = v_phone_n))) THEN
        v_item := jsonb_build_object('client_row_id', r_client_row_id, 'invite_id', NULL, 'status','active_invite_exists','token',NULL,'short_code',NULL,'error',NULL);
        v_items := v_items || v_item; CONTINUE;
      END IF;

      SELECT * INTO v_tok FROM public._gen_invite_token(); SELECT * INTO v_code FROM public._gen_short_code();
      INSERT INTO public.enrollment_invites (group_id, invited_by, batch_id, client_row_id, full_name, email, phone, class_grade, token_hash, short_code_hash)
      VALUES (p_group_id, auth.uid(), v_batch_id, r_client_row_id, r_full_name, r_email, r_phone, r_class_grade, v_tok.token_hash, v_code.code_hash)
      RETURNING id INTO v_new_id;

      v_item := jsonb_build_object('client_row_id', r_client_row_id, 'invite_id', v_new_id, 'status','invite_created', 'token', v_tok.raw_token, 'short_code', v_code.raw_code, 'error', NULL);
      v_items := v_items || v_item;
    EXCEPTION WHEN OTHERS THEN
      v_item := jsonb_build_object('client_row_id', coalesce(r_client_row_id,''), 'invite_id', NULL, 'status','invalid_data','token',NULL,'short_code',NULL,'error', SQLERRM);
      v_items := v_items || v_item;
    END;
  END LOOP;

  RETURN jsonb_build_object('batch_id', v_batch_id, 'items', v_items);
END; $$;
REVOKE ALL ON FUNCTION public.create_student_invite_batch(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_student_invite_batch(uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_student_invite(p_token text)
RETURNS TABLE(invite_id uuid, student_id uuid, group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_hash text := encode(digest(p_token, 'sha256'), 'hex'); v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_id FROM public.enrollment_invites WHERE token_hash = v_hash;
  IF v_id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT * FROM public._accept_invite_core(v_id);
END; $$;
REVOKE ALL ON FUNCTION public.accept_student_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_student_invite(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_student_invite_by_code(p_short_code text)
RETURNS TABLE(invite_id uuid, student_id uuid, group_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_norm text := public.normalize_short_code(p_short_code); v_hash text; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE = 'P0001'; END IF;
  IF v_norm IS NULL THEN RAISE EXCEPTION 'INVALID_CODE' USING ERRCODE = 'P0001'; END IF;
  v_hash := encode(digest(v_norm, 'sha256'), 'hex');
  SELECT id INTO v_id FROM public.enrollment_invites WHERE short_code_hash = v_hash;
  IF v_id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT * FROM public._accept_invite_core(v_id);
END; $$;
REVOKE ALL ON FUNCTION public.accept_student_invite_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_student_invite_by_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_student_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT invited_by INTO v_owner FROM public.enrollment_invites WHERE id = p_invite_id FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_owner <> auth.uid() AND NOT public.is_admin_or_owner() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.enrollment_invites SET status='revoked', revoked_at=now(), updated_at=now() WHERE id = p_invite_id AND status = 'pending';
END; $$;
REVOKE ALL ON FUNCTION public.revoke_student_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_student_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reissue_student_invite(p_invite_id uuid)
RETURNS TABLE(invite_id uuid, token text, short_code text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old public.enrollment_invites%ROWTYPE; v_tok RECORD; v_code RECORD; v_new_id uuid; v_expires timestamptz;
BEGIN
  SELECT * INTO v_old FROM public.enrollment_invites WHERE id = p_invite_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_old.invited_by <> auth.uid() AND NOT public.is_admin_or_owner() THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001'; END IF;
  IF v_old.status = 'accepted' THEN RAISE EXCEPTION 'INVITE_ALREADY_ACCEPTED' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.enrollment_invites SET status='revoked', revoked_at=now(), updated_at=now() WHERE id = p_invite_id AND status <> 'revoked';
  SELECT * INTO v_tok FROM public._gen_invite_token(); SELECT * INTO v_code FROM public._gen_short_code();
  v_expires := now() + interval '14 days';
  INSERT INTO public.enrollment_invites (group_id, invited_by, batch_id, client_row_id, full_name, email, phone, class_grade, token_hash, short_code_hash, expires_at)
  VALUES (v_old.group_id, v_old.invited_by, v_old.batch_id, v_old.client_row_id, v_old.full_name, v_old.email, v_old.phone, v_old.class_grade, v_tok.token_hash, v_code.code_hash, v_expires)
  RETURNING id INTO v_new_id;
  RETURN QUERY SELECT v_new_id, v_tok.raw_token, v_code.raw_code, v_expires;
END; $$;
REVOKE ALL ON FUNCTION public.reissue_student_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reissue_student_invite(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reissue_student_invite_batch(p_batch_id uuid)
RETURNS TABLE(client_row_id text, invite_id uuid, status text, token text, short_code text, expires_at timestamptz, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_batch public.enrollment_invite_batches%ROWTYPE;
  v_row public.enrollment_invites%ROWTYPE;
  v_tok RECORD; v_code RECORD; v_new_expires timestamptz;
BEGIN
  SELECT * INTO v_batch FROM public.enrollment_invite_batches WHERE id = p_batch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'BATCH_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

  IF NOT (public.is_admin_or_owner() OR (v_batch.invited_by = auth.uid() AND public.auth_is_teacher_of_group(v_batch.group_id))) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  FOR v_row IN SELECT * FROM public.enrollment_invites WHERE batch_id = p_batch_id ORDER BY created_at LOOP
    BEGIN
      IF v_row.status <> 'pending' THEN
        client_row_id := v_row.client_row_id; invite_id := v_row.id; status := v_row.status;
        token := NULL; short_code := NULL; expires_at := v_row.expires_at;
        error := 'not reissuable: ' || v_row.status;
        RETURN NEXT; CONTINUE;
      END IF;

      SELECT * INTO v_tok FROM public._gen_invite_token();
      SELECT * INTO v_code FROM public._gen_short_code();
      v_new_expires := now() + interval '14 days';

      UPDATE public.enrollment_invites
      SET token_hash = v_tok.token_hash, short_code_hash = v_code.code_hash, expires_at = v_new_expires, updated_at = now()
      WHERE id = v_row.id;

      client_row_id := v_row.client_row_id; invite_id := v_row.id; status := 'reissued';
      token := v_tok.raw_token; short_code := v_code.raw_code; expires_at := v_new_expires; error := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      client_row_id := v_row.client_row_id; invite_id := v_row.id; status := 'error';
      token := NULL; short_code := NULL; expires_at := v_row.expires_at; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
  RETURN;
END; $$;
REVOKE ALL ON FUNCTION public.reissue_student_invite_batch(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reissue_student_invite_batch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_students()
RETURNS TABLE(teacher_student_id uuid, student_id uuid, full_name text, email text, phone text, status text, source_invite_id uuid, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ts.id, ts.student_id, p.full_name, p.email, p.phone, ts.status, ts.source_invite_id, ts.created_at
  FROM public.teacher_students ts JOIN public.students s ON s.id = ts.student_id JOIN public.profiles p ON p.id = s.profile_id
  WHERE ts.teacher_id = (SELECT id FROM public.teachers WHERE profile_id = auth.uid()) OR public.is_admin_or_owner();
$$;
REVOKE ALL ON FUNCTION public.get_my_students() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_students() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_student_invites(p_group_id uuid DEFAULT NULL, p_status text DEFAULT NULL, p_batch_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, group_id uuid, invited_by uuid, batch_id uuid, client_row_id text, full_name text, email text, phone text, class_grade text, status text,
  expires_at timestamptz, accepted_by uuid, accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ei.id, ei.group_id, ei.invited_by, ei.batch_id, ei.client_row_id, ei.full_name, ei.email, ei.phone, ei.class_grade, ei.status,
    ei.expires_at, ei.accepted_by, ei.accepted_at, ei.revoked_at, ei.created_at, ei.updated_at
  FROM public.enrollment_invites ei
  WHERE (ei.invited_by = auth.uid() OR public.is_admin_or_owner())
    AND (p_group_id IS NULL OR ei.group_id = p_group_id) AND (p_status IS NULL OR ei.status = p_status) AND (p_batch_id IS NULL OR ei.batch_id = p_batch_id);
$$;
REVOKE ALL ON FUNCTION public.get_my_student_invites(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_student_invites(uuid,text,uuid) TO authenticated;

-- one-time backfill of historical group memberships (live group_students, not fixtures)
INSERT INTO public.teacher_students (teacher_id, student_id, source_invite_id, status)
SELECT g.teacher_id, gs.student_id, NULL, 'active'
FROM public.groups g
JOIN public.group_students gs ON gs.group_id = g.id
WHERE g.teacher_id IS NOT NULL
ON CONFLICT (teacher_id, student_id) DO NOTHING;
