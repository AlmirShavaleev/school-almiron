REVOKE EXECUTE ON FUNCTION public._review_queue_base(
  uuid, uuid, uuid, text, text[], timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
