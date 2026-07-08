-- Remove legacy overloaded update_variant_assignment that wrote nullable params directly.

drop function if exists public.update_variant_assignment(
  uuid,
  timestamptz,
  timestamptz,
  integer,
  boolean,
  boolean,
  boolean
);
