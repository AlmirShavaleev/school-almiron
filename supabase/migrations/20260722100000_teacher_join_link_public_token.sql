-- Fix: teacher_join_links stored only a hash of the join token, so a teacher could not
-- recover the plaintext link on page reload after cache loss, on a new device, or after
-- clearing storage -- create_or_get_teacher_join_link returned token=NULL for an existing
-- active link, forcing an unwanted rotation (which invalidates already-distributed links)
-- just to get a copyable URL. Adds a plaintext public_token column to the closed
-- teacher_join_links table (no direct grants to anon/authenticated, same as before) so the
-- owning teacher can always retrieve their own active link's token via the existing
-- SECURITY DEFINER RPCs. token_hash / submit_teacher_join_request validation is untouched.
ALTER TABLE public.teacher_join_links ADD COLUMN public_token text;
-- Table has zero rows in production at the time of this migration; NOT NULL + UNIQUE can be
-- added directly without a backfill step.
ALTER TABLE public.teacher_join_links ALTER COLUMN public_token SET NOT NULL;
ALTER TABLE public.teacher_join_links ADD CONSTRAINT teacher_join_links_public_token_key UNIQUE (public_token);

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
    -- Now always returns the owner's own token, regardless of device/cache state.
    RETURN jsonb_build_object('link_id', v_existing.id, 'is_new', false, 'token', v_existing.public_token, 'created_at', v_existing.created_at);
  END IF;

  v_raw := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_raw, 'sha256'), 'hex');
  INSERT INTO public.teacher_join_links (teacher_id, token_hash, public_token) VALUES (v_teacher_id, v_hash, v_raw) RETURNING id INTO v_id;

  RETURN jsonb_build_object('link_id', v_id, 'is_new', true, 'token', v_raw, 'created_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.create_or_get_teacher_join_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_get_teacher_join_link() TO authenticated;

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
  INSERT INTO public.teacher_join_links (teacher_id, token_hash, public_token, rotated_from_id)
  VALUES (v_teacher_id, v_hash, v_raw, v_old_id) RETURNING id INTO v_id;

  RETURN jsonb_build_object('link_id', v_id, 'is_new', true, 'token', v_raw, 'created_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.rotate_teacher_join_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_teacher_join_link() TO authenticated;
