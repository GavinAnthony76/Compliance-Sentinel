export interface AiEstimateInput {
  jobDescription: string;
  propertySize?: string | null;
  services?: string[] | null;
  companyName?: string | null;
}

export interface AiDraftLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface AiEstimateDraft {
  lineItems: AiDraftLineItem[];
  notes: string;
  source: "ai" | "mock";
}

function mockDraft(input: AiEstimateInput): AiEstimateDraft {
  return {
    lineItems: [
      { description: `Lawn service — ${input.jobDescription}`.slice(0, 120), quantity: 1, unitPrice: 120 },
      { description: "Cleanup and debris removal", quantity: 1, unitPrice: 45 },
    ],
    notes: "Draft generated automatically. Review and adjust pricing before sending.",
    source: "mock",
  };
}

export async function generateEstimateDraft(input: AiEstimateInput): Promise<AiEstimateDraft> {
  // Graceful fallback when the AI integration is not configured.
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return mockDraft(input);
  }

  const sys = "You are an estimator for a lawn-care company. Given a job description, produce a realistic itemized estimate. Respond ONLY with strict JSON of the form {\"lineItems\":[{\"description\":string,\"quantity\":number,\"unitPrice\":number}],\"notes\":string}. Use USD. Keep 1-6 line items. Prices should reflect typical US residential lawn-care rates.";

  const userMsg = [
    `Job description: ${input.jobDescription}`,
    input.propertySize ? `Property size: ${input.propertySize}` : "",
    input.services && input.services.length ? `Requested services: ${input.services.join(", ")}` : "",
    input.companyName ? `Company: ${input.companyName}` : "",
  ].filter(Boolean).join("\n");

  try {
    const { openai } = await import("@workspace/integrations-openai-ai-server");
    const completion = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw);
    const lineItems: AiDraftLineItem[] = Array.isArray(parsed.lineItems)
      ? parsed.lineItems
          .map((li: any) => ({
            description: String(li.description ?? "Service").slice(0, 200),
            quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
            unitPrice: Number(li.unitPrice) >= 0 ? Number(li.unitPrice) : 0,
          }))
          .slice(0, 6)
      : [];
    if (lineItems.length === 0) return mockDraft(input);
    return {
      lineItems,
      notes: typeof parsed.notes === "string" ? parsed.notes : "AI-generated draft. Review before sending.",
      source: "ai",
    };
  } catch {
    return mockDraft(input);
  }
}
