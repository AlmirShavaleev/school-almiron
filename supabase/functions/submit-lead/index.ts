import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const GOALS: Record<string, string> = {
  oge: "ОГЭ",
  ege: "ЕГЭ",
  improvement: "Повышение успеваемости",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return json({ ok: true });
  }

  const name = String(payload.name ?? "").trim();
  const phone = String(payload.phone ?? "").trim();
  const social = String(payload.social ?? "").trim().slice(0, 100) || null;
  const goal = String(payload.goal ?? "").trim() || null;
  const comment = String(payload.comment ?? "").trim().slice(0, 1000) || null;

  if (name.length < 1 || name.length > 100) return json({ error: "invalid_name" }, 400);
  if (phone.length < 5 || phone.length > 30 || !/^[+\d\s()-]+$/.test(phone)) {
    return json({ error: "invalid_phone" }, 400);
  }
  if (goal !== null && !(goal in GOALS)) return json({ error: "invalid_goal" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if ((count ?? 0) >= 5) return json({ error: "too_many_requests" }, 429);

  const { error: insertError } = await supabase
    .from("leads")
    .insert({ name, phone, social, goal, comment, source: "landing" });
  if (insertError) {
    console.error("leads insert failed:", insertError.message);
    return json({ error: "internal" }, 500);
  }

  const token = Deno.env.get("TG_BOT_TOKEN");
  const chatId = Deno.env.get("TG_CHAT_ID");
  if (token && chatId) {
    const text = [
      "🔔 Новая заявка на диагностику",
      `Имя: ${name}`,
      `Телефон: ${phone}`,
      social ? `TG/VK: ${social}` : null,
      goal ? `Цель: ${GOALS[goal]}` : null,
      comment ? `Комментарий: ${comment}` : null,
    ].filter(Boolean).join("\n");
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) console.error("telegram send failed:", await res.text());
    } catch (e) {
      console.error("telegram send error:", e);
    }
  }

  return json({ ok: true });
});
