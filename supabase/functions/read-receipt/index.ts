// Supabase Edge Function：讀取收據相片 → Google Gemini（免費額度）→ 回傳 JSON
// 需要設定 Secret：GEMINI_API_KEY（在 Google AI Studio 免費申請）
// 可選 Secret：GEMINI_MODEL（預設 gemini-2.5-flash；如 Google 推出新型號可在這裏更改）

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PROMPT = `You are reading a photo of a shop receipt for a Hong Kong company's expense log. Receipts are usually from South Korea, sometimes Japan, mainland China, Taiwan or Hong Kong.
Return ONLY a JSON object with exactly these keys:
{"date":"YYYY-MM-DD or empty string","merchant_orig":"store name exactly as printed","merchant_zh":"store name in Hong Kong Traditional Chinese (translate the meaning; keep well-known brand names such as GS25, CU, 7-Eleven, Olive Young, Daiso, Lawson as they are)","total":number (final amount actually paid, digits only),"currency":"KRW"|"JPY"|"CNY"|"TWD"|"HKD"|"USD"|"EUR","payment":"信用卡"|"現金"|"交通卡"|"其他","category":"food"|"stationery"|"transport"|"hotel"|"daily"|"shipping"|"other","items":[{"orig":"item as printed","zh":"Hong Kong Traditional Chinese translation","qty":number,"amount":number}],"summary_zh":"one short sentence in Hong Kong Traditional Chinese describing what was bought"}
Category guide: food = restaurants, cafes, bakeries, convenience-store food and drinks, snacks; stationery = pens, paper, notebooks, printing, office supplies (알파 문구, 모닝글로리); transport = taxi, train, KTX, subway, bus, car rental, parking, fuel, toll; hotel = hotels, guesthouses, accommodation; daily = cleaning, toiletries, household goods, Daiso general goods; shipping = post office (우체국, 郵便局), couriers (CJ대한통운, 택배, ヤマト); other = anything else.
Currency: Korean text or ₩/원 = KRW; Japanese or 円/¥ in Japan = JPY; simplified Chinese or 元 = CNY.
If mixed, choose the category with the largest amount. At most 20 item lines.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ error: "GEMINI_API_KEY not set" }, 500);
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";

  let image = "", mime = "image/jpeg";
  try {
    const body = await req.json();
    image = String(body.image || "");
    mime = String(body.mime || "image/jpeg");
  } catch {
    return json({ error: "bad request" }, 400);
  }
  if (!image || image.length > 8_000_000) return json({ error: "image missing or too large" }, 400);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: image } }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("gemini error", res.status, detail.slice(0, 500));
    return json({ error: `gemini ${res.status}` }, res.status === 429 ? 429 : 502);
  }
  const out = await res.json();
  const text = out?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || "";
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    return json(JSON.parse(cleaned));
  } catch {
    return json({ error: "could not parse AI output" }, 502);
  }
});
