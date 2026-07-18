## Legacy migrations archive

These SQL files are kept here as historical documentation only.

They were applied to remote databases under different migration versions than the
local filenames in this repository. Because of that, Supabase CLI must not see
them in `supabase/migrations/`: `supabase db push` could try to apply them again.

Re-applying these files is dangerous:
- `001_schema.sql` would attempt to recreate the base schema on top of a live database.
- `003_seed.sql`, `004_demo_users.sql`, and `005_demo_data.sql` contain demo data that must not be restored.
- The old numeric filenames do not reliably match remote `schema_migrations` versions.
- There is a duplicate `021` prefix in this archive, which is another reason these files cannot be treated as active CLI migrations.
- `20260715224500_fix_lesson_copy_live_homeworks_schema.sql` has no confirmed match in live `schema_migrations`; apply it only after explicit verification.

Rules:
- Do not move these files back into `supabase/migrations/` without first reconciling versions against remote `schema_migrations`.
- Do not use `supabase db push` on this project while the migration archive remains unreconciled.
- When a historical SQL file is needed for reference, copy its contents into a new reviewed migration with the exact remote version that will be recorded.
