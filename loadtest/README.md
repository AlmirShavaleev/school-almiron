# Almiron — isolated load comparison (20 virtual students)

STATUS: Configuration only. Never run against live School or a preview sharing its database.

## What is being compared

Baseline: main SHA 6f6e1a849d844dba3d6ed498cf22327b728d4893.
Optimized: PR #4 SHA d0eeee0dd990ce062515ee5311866997c6444fc4.
Both must be built at these exact commits as distinct immutable Vercel previews pointed at the SAME dedicated TEST Supabase.

Artillery launches one new student per second for 20 seconds, up to 20 simultaneous Chromium sessions. Each browser remains in a lesson for 75 seconds. The workflow reads My Courses, opens a seeded course, opens a seeded topic, then returns to My Courses. There are no deliberate homework submissions, answers, uploads, purchases, enrollment changes or edits.

## Mandatory isolation setup

1. Create a disposable, fully separate Supabase School TEST project (or independently isolated branch) including necessary migrations, RLS and synthetic course data. Do not clone production student records or credentials. Creation may incur cloud charges. As of 2026-11-14 there is no verified test branch in the active School project.
2. Seed exactly 20 synthetic student Auth accounts, matching student rows, group memberships, 20 readable open topic IDs and fake lesson materials. All users should have distinct email addresses beginning loadtest- or lt-. Every topic must be in the first visible module of the student's course, because the scenario clicks the first module.
3. Deploy both exact commits to distinct immutable preview deployments. Check that each deployment has only the new TEST VITE_SUPABASE_URL and public key. Disable or replace production webhooks, analytics, email, SMS, Bunny/private Storage calls and payments with test endpoints or inert mocks. A Vercel preview domain DOES NOT prove Supabase isolation.
4. Verify the deployed JS, test logins and Network tab manually. Every request must use the permitted preview origin or test Supabase origin. Ensure no access to any production student records. The runner has an automated asset check, but cannot prove lazy chunks and external resources are fully isolated: human inspection is mandatory.
5. Copy targets.example.json to targets.local.json. Set both immutable URLs, the same new test Supabase URL, and true for each of isolatedDbVerified, previewBuildVerified, readOnlyFixtureConfirmed after verification.
6. Create students.local.csv with header email,password,groupId,topicId followed by EXACTLY twenty distinct rows. Values are synthetic and not committed. Passwords must be 12+ characters; IDs must be UUIDs. Do not use real students.

## Install and preflight (Windows PowerShell)

From repository root:
  cd loadtest
  npm install
  npx playwright install chromium
  npm run check:guard
  npm run preflight

The preflight checks local configurations, denies known production refs/domains, verifies two preview HTML/main JS bundles via a few GET requests, and compares their embedded test Supabase hostname. No workload is started. Do not proceed unless it passes AND manual review was completed.

npm install generates loadtest/package-lock.json; review and commit a verified lockfile separately when stabilizing this toolchain. No dependencies are installed by the GitHub CI guard.

## Manual load run (ONLY after preflight and approval)

  $env:LOADTEST_EXECUTE='I_CONFIRM_ISOLATED_LOADTEST'
  npm run run:main
  npm run run:pr4
  npm run compare
  Remove-Item Env:LOADTEST_EXECUTE

On macOS/Linux set LOADTEST_EXECUTE=I_CONFIRM_ISOLATED_LOADTEST for each run. Run the two targets SEQUENTIALLY, never simultaneously, to avoid doubled load on the test DB.

Results are stored only in loadtest/results/ (ignored by Git). The compare command requires all 20 sessions to complete in both runs. It reports p50/p95 of app readiness and API request counts; unavailable Artillery metrics remain null, never fabricated. Repeat alternating baseline and optimized runs several times to reduce variability.

## Guard and limitations

- The browser denies all network origins other than the selected preview and isolated test Supabase.
- It allows GET/HEAD/OPTIONS for the isolated origins, login token POST on test Auth, and ONLY an explicit allowlist of read RPC POSTs plus presence/telemetry on test Supabase. All REST table writes, unknown RPCs, payment and external domains are blocked. Any denied request fails the session.
- Presence and RUM can write to the TEST database; the scenario is read-only regarding educational data, not literally zero backend writes.
- External asset/CDN requests are blocked intentionally and can affect browser visual readiness. Do not loosen without auditing the requested host and purpose.
- The existing e2e/global-setup.ts creates fixtures and is deliberately NOT used here.
- No load test runs on push, pull request or CI. GitHub only syntax-checks the guard. No changes to main, PR #4 or production.
- This benchmark does not certify real production performance or production RLS; it measures an isolated environment.

## Expected measurements

- Readiness timing for My Courses, course, topic and return visit (p50/p95).
- Endpoint counts for group_students, my_course_topic_locks and school_presence_touch.
- Total browser API calls, virtual-user errors and optional browser web vitals (depending on Artillery version).
- Compare main vs PR #4 on the same isolated database, same accounts, same machine/region, same browser and similar background load.
