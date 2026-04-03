export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing GEMINI_API_KEY on server" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const userAnswer = typeof body.userAnswer === "string" ? body.userAnswer.trim() : "";
  const acceptedAnswers = Array.isArray(body.acceptedAnswers) ? body.acceptedAnswers : [];
  const keywordGroups = Array.isArray(body.keywordGroups) ? body.keywordGroups : [];
  const modelAnswer = typeof body.modelAnswer === "string" ? body.modelAnswer.trim() : "";

  if (!question || !userAnswer) {
    return res.status(400).json({ error: "question and userAnswer are required" });
  }

  const prompt = [
    "أنت مصحح عربي خبير للصف الرابع الابتدائي.",
    "المطلوب: قيّم إجابة طالب على سؤال مقالي قصير.",
    "قواعد التصحيح:",
    "1) صحّح بالمعنى وليس بالحرف.",
    "2) تقبل الأخطاء الإملائية البسيطة إذا كان المعنى صحيحاً.",
    "3) تقبل أي صياغة بديلة صحيحة حتى لو لم تطابق النص الحرفي.",
    "4) لا تتشدد في التشكيل أو علامات الترقيم.",
    "أعد النتيجة بصيغة JSON فقط بدون أي نص إضافي بهذه البنية:",
    "{\"isCorrect\": true/false, \"feedback\": \"تعليق عربي قصير\"}",
    "",
    `السؤال: ${question}`,
    `إجابة الطالب: ${userAnswer}`,
    `نماذج إجابة مرجعية: ${JSON.stringify(acceptedAnswers)}`,
    `مجموعات كلمات مفتاحية (كل مجموعة يجب أن يتحقق معناها): ${JSON.stringify(keywordGroups)}`,
    `نموذج الإجابة المدرسي: ${modelAnswer}`
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 220
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: `Gemini request failed: ${response.status}`, details: errorText });
    }

    const payload = await response.json();
    const text = ((payload.candidates || [])[0]?.content?.parts || [])
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n")
      .trim();

    const raw = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (secondError) {
          parsed = null;
        }
      }
    }

    if (!parsed || typeof parsed.isCorrect !== "boolean") {
      return res.status(502).json({ error: "Invalid AI grading format", raw: text });
    }

    return res.status(200).json({
      isCorrect: parsed.isCorrect,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback.trim() : ""
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to contact Gemini", details: String(error) });
  }
}

