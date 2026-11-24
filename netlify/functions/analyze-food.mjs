export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Разрешён только POST-запрос.' }, 405);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'На Netlify ещё не настроен GEMINI_API_KEY.' }, 503);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Некорректный запрос.' }, 400); }
  const { mimeType, data } = body || {};
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || typeof data !== 'string') {
    return json({ error: 'Поддерживаются JPEG, PNG и WebP.' }, 400);
  }
  if (data.length > 7_000_000) return json({ error: 'Фото слишком большое. Попробуй снимок меньшего размера.' }, 413);

  const prompt = `Ты помощник для дневника питания. Проанализируй фотографию еды и верни ТОЛЬКО JSON.
Оцени видимые продукты, примерную общую съедобную массу порции и КБЖУ ВСЕЙ порции (не на 100 г).
Не выдумывай точность: если состав или вес неясны, укажи разумную приблизительную оценку и поясни неопределённость в notes. Учитывай возможные масло, соусы и гарниры только если они видны или обоснованно предполагаются.
Формат JSON:
{"name":"короткое название блюда","portion_grams":300,"kcal":600,"protein":30,"fat":25,"carbs":55,"confidence":"низкая|средняя|высокая","ingredients":[{"name":"продукт","grams":150}],"notes":"короткое пояснение или что уточнить"}
Все числа должны быть неотрицательными. Не добавляй Markdown.`;

  try {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data } }, { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 700 }
      })
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = payload?.error?.message || 'Ошибка сервиса распознавания.';
      return json({ error: message }, upstream.status === 429 ? 429 : 502);
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) return json({ error: 'ИИ не вернул результат. Попробуй другое фото.' }, 502);
    let food;
    try { food = JSON.parse(text); } catch { return json({ error: 'Не удалось разобрать ответ ИИ. Попробуй ещё раз.' }, 502); }
    const numeric = ['portion_grams', 'kcal', 'protein', 'fat', 'carbs'];
    for (const key of numeric) food[key] = Math.max(0, Number(food[key]) || 0);
    if (!food.name) food.name = 'Блюдо по фото';
    return json({ food });
  } catch {
    return json({ error: 'Не удалось связаться с сервисом распознавания. Проверь интернет и попробуй снова.' }, 502);
  }
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
