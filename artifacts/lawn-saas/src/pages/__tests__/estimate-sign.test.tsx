import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));
vi.mock("@/hooks/use-page-meta", () => ({ usePageMeta: () => {} }));
vi.mock("wouter", () => ({ useParams: () => ({ token: "raw-share-token" }) }));

import { EstimateSignPage } from "../estimate-sign";

const EMAILED = /has been emailed to you/i;

const unsignedEstimate = {
  id: 1,
  estimateNumber: "EST-1",
  status: "sent",
  subtotal: 100,
  tax: 0,
  total: 100,
  signedAt: null,
  signerName: null,
  lineItems: [],
  customer: { firstName: "Casey", lastName: "Customer", email: "casey@customer.test" },
  company: { name: "Acme Lawn Co" },
};

function mockApi({ getBody, signBody }: { getBody: unknown; signBody?: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.method === "POST" ? signBody : getBody;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// jsdom has no canvas: give the signature pad a no-op 2D context so drawing
// registers a signature, and a fixed data URL for submission.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {},
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AAAA");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function signThePage() {
  const canvas = (await screen.findByText(/Draw your signature here/)).closest("div")!.parentElement!.querySelector("canvas")!;
  fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(canvas, { clientX: 40, clientY: 30 });
  fireEvent.mouseUp(canvas);
  fireEvent.click(screen.getByRole("button", { name: /Accept & Sign Estimate/ }));
  await screen.findByText("Estimate Accepted");
}

describe("EstimateSignPage signed-copy email confirmation", () => {
  it("does not claim the copy was emailed when delivery failed for a customer who has an email", async () => {
    mockApi({
      getBody: unsignedEstimate,
      signBody: {
        success: true,
        signedAt: "2026-10-21T12:00:00.000Z",
        signerName: "Casey Customer",
        customerHasEmail: true,
        signedCopyEmailed: false,
        message: "Thank you! Your estimate has been signed and accepted. You can download a signed copy below.",
      },
    });

    render(<EstimateSignPage />);
    await signThePage();

    expect(screen.queryByText(EMAILED)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't email your signed copy/i)).toBeInTheDocument();
    expect(screen.getByText(/Download signed copy/)).toBeInTheDocument();
    expect(screen.getByText("Signed by Casey Customer")).toBeInTheDocument();
  });

  it("confirms the email only when the server reports confirmed delivery", async () => {
    mockApi({
      getBody: unsignedEstimate,
      signBody: {
        success: true,
        signedAt: "2026-10-21T12:00:00.000Z",
        signerName: "Casey Customer",
        customerHasEmail: true,
        signedCopyEmailed: true,
        message: "Thank you! Your estimate has been signed and accepted. A signed copy has been emailed to you.",
      },
    });

    render(<EstimateSignPage />);
    await signThePage();

    expect(screen.getByText(EMAILED)).toBeInTheDocument();
    expect(screen.queryByText(/couldn't email/i)).not.toBeInTheDocument();
  });

  it("after a reload of a signed estimate, makes no email claim even though the customer has an email", async () => {
    mockApi({
      getBody: { ...unsignedEstimate, status: "accepted", signedAt: "2026-10-21T12:00:00.000Z", signerName: "Casey Customer" },
    });

    render(<EstimateSignPage />);

    await screen.findByText("Estimate Accepted");
    expect(screen.queryByText(EMAILED)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't email/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Download signed copy/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Signed by Casey Customer")).toBeInTheDocument());
  });
});
