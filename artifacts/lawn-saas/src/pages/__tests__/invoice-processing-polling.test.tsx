import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

vi.mock("@/components/layout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/hooks/use-auth-state", () => ({
  useAuthState: () => ({
    user: { id: 1, email: "owner@example.com", company: { id: 1, name: "GreenSynk", subscriptionPlan: "pro" } },
  }),
}));

const portalAuthState: any = {
  isLoading: false,
  isAuthenticated: true,
  session: { customer: { id: 1, firstName: "Pat", lastName: "Lee", email: "p@example.com", phone: null }, company: { id: 1, name: "GreenSynk", slug: "greensynk", logoUrl: null, primaryColor: null } },
  portalFetch: vi.fn(),
};
vi.mock("@/hooks/use-portal-auth", () => ({
  usePortalAuth: () => portalAuthState,
  PORTAL_TOKEN_KEY: "greensync_portal_token",
}));

import { InvoicesPage, InvoiceDetailModal } from "../invoices";
import { InvoiceDetailPanel, PortalInvoicesPage } from "../portal-invoices";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const summary = { outstanding: 0, paidTotal: 0, paidOnline: 0, paidOffline: 0 };

function listBody(status: string) {
  return {
    invoices: [
      { id: 1, invoiceNumber: "INV-1001", customerName: "Pat Lee", total: "50.00", status, dueDate: null },
    ],
    summary,
    pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
  };
}

function detailBody(status: string) {
  return {
    id: 1,
    invoiceNumber: "INV-1001",
    customerName: "Pat Lee",
    status,
    total: "50.00",
    lineItems: [],
  };
}

let originalFetch: typeof fetch;

beforeEach(() => {
  vi.useFakeTimers();
  toastMock.mockClear();
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("staff invoice list polling (invoices.tsx)", () => {
  it("refetches every 4s while an invoice is processing, then stops once it settles", async () => {
    // Serve "processing" for the first two list fetches, then "paid".
    let listCalls = 0;
    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/invoices")) {
        listCalls += 1;
        return jsonResponse(listBody(listCalls < 3 ? "processing" : "paid"));
      }
      return jsonResponse({});
    }) as any;

    renderWithQueryClient(<InvoicesPage />);
    await flush();
    expect(listCalls).toBe(1);
    expect(screen.getByText("Payment in progress…")).toBeInTheDocument();

    // Poll #1 at ~4s: still processing.
    await advance(4100);
    expect(listCalls).toBe(2);

    // Poll #2 at ~8s: server now reports paid.
    await advance(4100);
    expect(listCalls).toBe(3);
    await flush();
    expect(screen.getAllByText("Paid").length).toBeGreaterThan(0);
    expect(screen.queryByText("Payment in progress…")).not.toBeInTheDocument();

    // Settled: no further polling even after several intervals.
    await advance(20000);
    expect(listCalls).toBe(3);
  });

  it("does not poll at all when no invoice is processing", async () => {
    let listCalls = 0;
    global.fetch = vi.fn(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/invoices")) {
        listCalls += 1;
        return jsonResponse(listBody("sent"));
      }
      return jsonResponse({});
    }) as any;

    renderWithQueryClient(<InvoicesPage />);
    await flush();
    expect(listCalls).toBe(1);

    await advance(20000);
    expect(listCalls).toBe(1);
  });
});

describe("staff invoice detail modal polling (invoices.tsx)", () => {
  it("re-fetches the detail every 4s while processing, then stops once paid", async () => {
    let detailCalls = 0;
    global.fetch = vi.fn(async () => {
      detailCalls += 1;
      return jsonResponse(detailBody(detailCalls < 3 ? "processing" : "paid"));
    }) as any;

    render(
      <InvoiceDetailModal
        invoice={{ id: 1, invoiceNumber: "INV-1001", status: "processing" }}
        onClose={() => {}}
      />,
    );
    await flush();
    expect(detailCalls).toBe(1);
    expect(screen.getByText("Payment in progress…")).toBeInTheDocument();

    await advance(4100);
    expect(detailCalls).toBe(2);

    await advance(4100);
    expect(detailCalls).toBe(3);
    await flush();
    expect(screen.getByText("Paid")).toBeInTheDocument();

    // Settled: the timeout chain must not be re-armed.
    await advance(20000);
    expect(detailCalls).toBe(3);
  });

  it("stops polling when the modal unmounts mid-processing", async () => {
    let detailCalls = 0;
    global.fetch = vi.fn(async () => {
      detailCalls += 1;
      return jsonResponse(detailBody("processing"));
    }) as any;

    const { unmount } = render(
      <InvoiceDetailModal
        invoice={{ id: 1, invoiceNumber: "INV-1001", status: "processing" }}
        onClose={() => {}}
      />,
    );
    await flush();
    expect(detailCalls).toBe(1);

    unmount();
    await advance(20000);
    expect(detailCalls).toBe(1);
  });
});

describe("portal invoice detail panel polling (portal-invoices.tsx)", () => {
  const basePortalDetail = {
    id: "inv-1",
    invoiceNumber: "INV-1001",
    total: "50.00",
    companyName: "GreenSynk",
    companyPlan: "pro",
    lineItems: [],
    paymentConfig: { acceptedPaymentMethods: ["card"] },
  };

  it("polls the detail every 4s while processing and stops once it settles", async () => {
    let detailCalls = 0;
    const portalFetch = vi.fn(async () => {
      detailCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ...basePortalDetail, status: detailCalls < 3 ? "processing" : "paid" }),
      };
    });

    render(
      <InvoiceDetailPanel
        invoice={{ id: "inv-1", invoiceNumber: "INV-1001", status: "processing", total: "50.00" }}
        slug="greensynk"
        onBack={() => {}}
        portalFetch={portalFetch}
      />,
    );
    await flush();
    expect(detailCalls).toBe(1);
    expect(screen.getByText(/We're processing a payment for this invoice/i)).toBeInTheDocument();

    await advance(4100);
    expect(detailCalls).toBe(2);

    await advance(4100);
    expect(detailCalls).toBe(3);
    await flush();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.queryByText(/We're processing a payment/i)).not.toBeInTheDocument();

    await advance(20000);
    expect(detailCalls).toBe(3);
  });

  it("never starts polling for an already-settled invoice", async () => {
    let detailCalls = 0;
    const portalFetch = vi.fn(async () => {
      detailCalls += 1;
      return { ok: true, status: 200, json: async () => ({ ...basePortalDetail, status: "paid" }) };
    });

    render(
      <InvoiceDetailPanel
        invoice={{ id: "inv-1", invoiceNumber: "INV-1001", status: "paid", total: "50.00" }}
        slug="greensynk"
        onBack={() => {}}
        portalFetch={portalFetch}
      />,
    );
    await flush();
    expect(detailCalls).toBe(1);

    await advance(20000);
    expect(detailCalls).toBe(1);
  });
});

describe("portal invoice list polling (portal-invoices.tsx)", () => {
  function portalListItem(status: string) {
    return { id: "inv-1", invoiceNumber: "INV-1001", status, total: "50.00", dueDate: null };
  }

  it("polls the list every 4s while an invoice is processing, then stops", async () => {
    let listCalls = 0;
    portalAuthState.portalFetch = vi.fn(async (url: string) => {
      if (url === "/api/portal/invoices") {
        listCalls += 1;
        return { ok: true, status: 200, json: async () => [portalListItem(listCalls < 3 ? "processing" : "paid")] };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<PortalInvoicesPage />);
    await flush();
    expect(listCalls).toBe(1);
    expect(screen.getByText("Payment in progress…")).toBeInTheDocument();

    await advance(4100);
    expect(listCalls).toBe(2);

    await advance(4100);
    expect(listCalls).toBe(3);
    await flush();
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.queryByText("Payment in progress…")).not.toBeInTheDocument();

    await advance(20000);
    expect(listCalls).toBe(3);
  });

  it("does not poll when no invoice is processing", async () => {
    let listCalls = 0;
    portalAuthState.portalFetch = vi.fn(async (url: string) => {
      if (url === "/api/portal/invoices") {
        listCalls += 1;
        return { ok: true, status: 200, json: async () => [portalListItem("sent")] };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    render(<PortalInvoicesPage />);
    await flush();
    expect(listCalls).toBe(1);

    await advance(20000);
    expect(listCalls).toBe(1);
  });
});
