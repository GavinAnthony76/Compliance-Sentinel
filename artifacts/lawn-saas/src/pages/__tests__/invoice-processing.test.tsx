import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, toasts: [], dismiss: vi.fn() }),
}));

import { InvoiceStatusBadge, statusLabel } from "../invoices";
import { StatusBadge, InvoiceDetailPanel } from "../portal-invoices";

beforeEach(() => {
  toastMock.mockClear();
});

describe("staff invoice status badge (invoices.tsx)", () => {
  it("shows 'Payment in progress…' with amber styling and a spinner for status=processing", () => {
    const { container } = render(<InvoiceStatusBadge status="processing" />);
    const badge = screen.getByText("Payment in progress…").closest("span");
    expect(badge).toBeInTheDocument();
    expect(badge!.className).toContain("bg-amber-100");
    expect(badge!.className).toContain("text-amber-700");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("does not show a spinner for other statuses", () => {
    const { container } = render(<InvoiceStatusBadge status="sent" />);
    expect(screen.getByText("Sent")).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeInTheDocument();
  });

  it("maps the raw 'processing' status to the friendly label", () => {
    expect(statusLabel("processing")).toBe("Payment in progress…");
    expect(statusLabel("paid")).toBe("Paid");
  });
});

describe("portal invoice status badge (portal-invoices.tsx)", () => {
  it("shows the amber processing badge with spinner", () => {
    const { container } = render(<StatusBadge status="processing" />);
    const badge = screen.getByText("Payment in progress…").closest("span");
    expect(badge!.className).toContain("bg-amber-100");
    expect(badge!.className).toContain("text-amber-800");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });
});

function makePortalFetch(detail: any, payResponse?: { status: number; body: any }) {
  return vi.fn(async (url: string, opts?: any) => {
    if (url.endsWith("/pay") && opts?.method === "POST") {
      const r = payResponse ?? { status: 200, body: { url: null } };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
      };
    }
    return { ok: true, status: 200, json: async () => detail };
  });
}

const baseInvoice = { id: "inv-1", invoiceNumber: "INV-1001", status: "sent", total: "50.00" };

const baseDetail = {
  id: "inv-1",
  invoiceNumber: "INV-1001",
  status: "sent",
  total: "50.00",
  companyName: "GreenSynk Lawn Co",
  companyPlan: "pro",
  lineItems: [],
  paymentConfig: { acceptedPaymentMethods: ["card"] },
};

describe("portal invoice detail panel (portal-invoices.tsx)", () => {
  it("shows the processing indicator instead of the Pay Online Now button when status=processing", async () => {
    const portalFetch = makePortalFetch({ ...baseDetail, status: "processing" });
    render(
      <InvoiceDetailPanel
        invoice={{ ...baseInvoice, status: "processing" }}
        slug="greensynk"
        onBack={() => {}}
        portalFetch={portalFetch}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/We're processing a payment for this invoice/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Payment in progress…").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Pay Online Now/i })).not.toBeInTheDocument();
  });

  it("shows the Pay Online Now button for a sent card-payable invoice", async () => {
    const portalFetch = makePortalFetch(baseDetail);
    render(
      <InvoiceDetailPanel
        invoice={baseInvoice}
        slug="greensynk"
        onBack={() => {}}
        portalFetch={portalFetch}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Pay Online Now/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/We're processing a payment/i)).not.toBeInTheDocument();
  });

  it("handles a 409 ChargeInProgress from /pay with a friendly toast and flips to processing", async () => {
    const portalFetch = makePortalFetch(baseDetail, {
      status: 409,
      body: { error: "ChargeInProgress", message: "A charge is already in progress" },
    });
    render(
      <InvoiceDetailPanel
        invoice={baseInvoice}
        slug="greensynk"
        onBack={() => {}}
        portalFetch={portalFetch}
      />,
    );

    const payButton = await screen.findByRole("button", { name: /Pay Online Now/i });
    await userEvent.click(payButton);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const call = toastMock.mock.calls[0][0];
    expect(call.title).toBe("Payment in progress");
    expect(call.description).toMatch(/already being processed/i);
    expect(call.variant).toBeUndefined();

    await waitFor(() =>
      expect(screen.getByText(/We're processing a payment for this invoice/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /Pay Online Now/i })).not.toBeInTheDocument();
  });

  it("still surfaces a destructive toast for non-409 payment errors", async () => {
    const portalFetch = makePortalFetch(baseDetail, {
      status: 500,
      body: { message: "Something broke" },
    });
    render(
      <InvoiceDetailPanel
        invoice={baseInvoice}
        slug="greensynk"
        onBack={() => {}}
        portalFetch={portalFetch}
      />,
    );

    const payButton = await screen.findByRole("button", { name: /Pay Online Now/i });
    await userEvent.click(payButton);

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const call = toastMock.mock.calls[0][0];
    expect(call.title).toBe("Payment failed");
    expect(call.variant).toBe("destructive");
    expect(screen.queryByText(/We're processing a payment/i)).not.toBeInTheDocument();
  });
});
