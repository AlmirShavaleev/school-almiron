# Migrations policy

This project must not use `supabase db push` in normal workflow.

## Why

The repository contains an archived set of historical migrations whose local
filenames do not reliably match the versions already recorded in remote
`schema_migrations`. Pushing local files blindly can re-apply old schema and
demo-data scripts to a live database.

## Required workflow

1. Prepare SQL intentionally and review it before applying.
2. Apply migrations through the approved MCP/review-gated process, not through `supabase db push`.
3. Save the SQL in the repository using the exact same migration version that is written into remote `schema_migrations`.
4. Keep active CLI-visible migrations only in `supabase/migrations/`.
5. Keep historical or ambiguous files in `supabase/migrations/_legacy/` until their versions are fully reconciled.

## Naming rule

The filename must begin with the exact migration version used in the database.

Examples:
- `20260718111619_fix_homeworks_topic_id_fk_restrict.sql`
- `20260718130523_allow_lesson_copy_without_group.sql`

Do not rename a migration after it has been applied. If SQL changes after review,
create a new migration with a new version.

## Explicit prohibition

- Do not run `supabase db push` on this project until the legacy archive has been fully audited and matched against remote `schema_migrations`.
- Do not restore archived `001-021` files into the active migrations directory.
- Do not rely on local numeric prefixes such as `010`, `013`, `016`, `019`, or duplicated `021` to infer remote state.
