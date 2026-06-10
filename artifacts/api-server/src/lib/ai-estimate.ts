export interface AiCatalogService {
  name: string;
  description?: string | null;
  basePrice?: number | null;
}

export interface AiEstimateInput {
  jobDescription: string;
  propertySize?: string | null;
  services?: string[] | null;
  companyName?: string | null;
  /** The company's service catalog. When provided, AI output is constrained to these services. */
  catalog?: AiCatalogService[] | null;
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

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Snap an AI/mock line item description to the closest catalog service. Returns the
// matched catalog service or null when there's no reasonable match.
function matchCatalog(description: string, catalog: AiCatalogService[]): AiCatalogService | null {
  const desc = normalize(description);
  if (!desc) return null;
  // Exact-ish containment first (either direction), then token overlap.
  let best: { svc: AiCatalogService; score: number } | null = null;
  for (const svc of catalog) {
    const name = normalize(svc.name);
    if (!name) continue;
    let score = 0;
    if (desc === name) score = 100;
    else if (desc.includes(name) || name.includes(desc)) score = 60;
    else {
      const nameTokens = new Set(name.split(" "));
      const descTokens = desc.split(" ");
      const overlap = descTokens.filter(t => nameTokens.has(t)).length;
      score = overlap > 0 ? overlap * 10 : 0;
    }
    if (score > 0 && (!best || score > best.score)) best = { svc, score };
  }
  return best && best.score >= 10 ? best.svc : null;
}

// Constrain a set of line items to the catalog: keep only items that map to a catalog
// service, rename them to the catalog name, and prefer the catalog base price.
function constrainToCatalog(lineItems: AiDraftLineItem[], catalog: AiCatalogService[]): AiDraftLineItem[] {
  const seen = new Set<string>();
  const out: AiDraftLineItem[] = [];
  for (const li of lineItems) {
    const match = matchCatalog(li.description, catalog);
    if (!match) continue;
    const key = normalize(match.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      description: match.name,
      quantity: li.quantity > 0 ? li.quantity : 1,
      unitPrice: match.basePrice != null && match.basePrice >= 0 ? match.basePrice : (li.unitPrice >= 0 ? li.unitPrice : 0),
    });
  }
  return out;
}

function mockDraft(input: AiEstimateInput): AiEstimateDraft {
  // When a catalog exists, build the mock draft straight from catalog entries so we
  // never invent services the company doesn't offer.
  if (input.catalog && input.catalog.length > 0) {
    const lineItems = input.catalog.slice(0, 3).map(svc => ({
      description: svc.name,
      quantity: 1,
      unitPrice: svc.basePrice != null && svc.basePrice >= 0 ? svc.basePrice : 0,
    }));
    return {
      lineItems,
      notes: "Draft built from your service catalog. Review and adjust pricing before sending.",
      source: "mock",
    };
  }
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
  const hasCatalog = !!(input.catalog && input.catalog.length > 0);

  // Graceful fallback when the AI integration is not configured.
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || !process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    return mockDraft(input);
  }

  const catalogBlock = hasCatalog
    ? `\nYou MUST only choose services from this catalog (use the exact service name as the line item description, and prefer the listed price):\n${input.catalog!.map(s => `- ${s.name}${s.basePrice != null ? ` ($${s.basePrice})` : ""}${s.description ? ` — ${s.description}` : ""}`).join("\n")}\nDo NOT invent services that are not in this catalog.`
    : "";

  const sys = `You are an estimator for a lawn-care company. Given a job description, produce a realistic itemized estimate. Respond ONLY with strict JSON of the form {"lineItems":[{"description":string,"quantity":number,"unitPrice":number}],"notes":string}. Use USD. Keep 1-6 line items. Prices should reflect typical US residential lawn-care rates.${catalogBlock}`;

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
    let lineItems: AiDraftLineItem[] = Array.isArray(parsed.lineItems)
      ? parsed.lineItems
          .map((li: any) => ({
            description: String(li.description ?? "Service").slice(0, 200),
            quantity: Number(li.quantity) > 0 ? Number(li.quantity) : 1,
            unitPrice: Number(li.unitPrice) >= 0 ? Number(li.unitPrice) : 0,
          }))
          .slice(0, 6)
      : [];
    // Enforce the catalog constraint on the model output.
    if (hasCatalog) {
      lineItems = constrainToCatalog(lineItems, input.catalog!);
    }
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
