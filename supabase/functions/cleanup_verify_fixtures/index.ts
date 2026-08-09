import { createClient } from "jsr:@supabase/supabase-js@2";

// One-off cleanup: deletes ONLY these exact, hardcoded test-fixture
// paths left behind by lesson_library DO-verification runs. No
// user-supplied path input — cannot be used as a general delete
// endpoint. Safe to leave deployed as a no-op once these are gone.
const TARGETS: Array<{ bucket: string; paths: string[] }> = [
  {
    bucket: "course-materials",
    paths: ["topics/4fe6cfed-28a6-4be0-bc2f-62e7a25654cb/notes/verify.png"],
  },
  {
    bucket: "lesson-library",
    paths: [
      "owner/43396c60-0c26-4c7d-a944-1dfa727353be/templates/11111111-1111-1111-1111-111111111111/notes/verify.png",
      "owner/43396c60-0c26-4c7d-a944-1dfa727353be/templates/11111111-1111-1111-1111-111111111111/notes/verify.txt",
    ],
  },
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async () => {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const results: Record<string, unknown> = {};

  for (const target of TARGETS) {
    const { data, error } = await serviceClient.storage.from(target.bucket).remove(target.paths);
    results[target.bucket] = { data, error: error?.message ?? null };
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
