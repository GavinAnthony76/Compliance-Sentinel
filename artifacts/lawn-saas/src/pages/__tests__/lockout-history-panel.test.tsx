import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn(), toasts: [], dismiss: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useAdminListAdmins: () => ({ data: undefined, isLoading: false }),
  useAdminCreateAdmin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdminGetMe: () => ({ data: undefined }),
  getAdminListAdminsQueryKey: () => ["admins"],
}));

vi.mock("../admin-dashboard", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { LockoutHistoryPanel } from "../admin-admins";

const HOUR = 60 * 60 * 1000;

function mockFetchWith(body: any, ok = true, status = 200) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.setItem("greensync_admin_token", "test-token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("LockoutHistoryPanel (admin-admins.tsx)", () => {
  it("renders the newest run as the last run with date, count, and threshold", async () => {
    const newest = new Date("2026-07-21T02:00:00Z");
    const older = new Date("2026-07-20T02:00:00Z");
    vi.useFakeTimers({ now: newest.getTime() + 2 * HOUR, toFake: ["Date"] });
    mockFetchWith({
      sweepEnabled: true,
      runs: [
        { id: 2, ranAt: newest.toISOString(), deactivatedCount: 3, thresholdDays: 90 },
        { id: 1, ranAt: older.toISOString(), deactivatedCount: 0, thresholdDays: 60 },
      ],
    });

    render(<LockoutHistoryPanel />);

    const lastRunLine = await screen.findByText(/Last ran/);
    expect(lastRunLine.textContent).toContain("3 admins deactivated");
    expect(lastRunLine.textContent).toContain("(90-day threshold)");
    // Newest run's formatted date should be in the summary line, not the older one's
    expect(lastRunLine.textContent).toMatch(/Jul 2[01], 2026/);
    vi.useRealTimers();
  });

  it("expands to show the full history with per-run date, count, and threshold", async () => {
    const runs = [
      { id: 3, ranAt: "2026-07-21T02:00:00Z", deactivatedCount: 2, thresholdDays: 90 },
      { id: 2, ranAt: "2026-07-20T02:00:00Z", deactivatedCount: 0, thresholdDays: 90 },
      { id: 1, ranAt: "2026-07-19T02:00:00Z", deactivatedCount: 1, thresholdDays: 45 },
    ];
    mockFetchWith({ sweepEnabled: true, runs });

    render(<LockoutHistoryPanel />);

    const toggle = await screen.findByText(/View history \(3\)/);
    await userEvent.click(toggle);

    expect(screen.getByText("2 deactivated")).toBeInTheDocument();
    expect(screen.getByText("No admins deactivated")).toBeInTheDocument();
    const oneDeactivated = screen.getByText("1 deactivated");
    expect(oneDeactivated).toBeInTheDocument();
    expect(oneDeactivated.textContent).toContain("45-day threshold");
    // Each expanded row shows a formatted date
    expect(screen.getAllByText(/Jul \d{1,2}, 2026/).length).toBeGreaterThanOrEqual(3);
  });

  it("shows a sensible empty state when there are no runs yet", async () => {
    mockFetchWith({ sweepEnabled: true, runs: [] });

    render(<LockoutHistoryPanel />);

    expect(await screen.findByText("The automated sweep hasn't run yet.")).toBeInTheDocument();
    expect(screen.getByText("Automatic inactivity lockout")).toBeInTheDocument();
    expect(screen.queryByText(/View history/)).not.toBeInTheDocument();
    // Enabled-but-never-run should surface a warning, not a blank panel
    expect(
      screen.getByText(/enabled but has never run/),
    ).toBeInTheDocument();
  });

  it("shows a friendly error state when the request fails", async () => {
    mockFetchWith({}, false, 500);

    render(<LockoutHistoryPanel />);

    expect(
      await screen.findByText("Couldn't load the sweep history right now."),
    ).toBeInTheDocument();
  });

  it("labels a single-admin run with singular wording", async () => {
    mockFetchWith({
      sweepEnabled: true,
      runs: [{ id: 1, ranAt: new Date().toISOString(), deactivatedCount: 1, thresholdDays: 90 }],
    });

    render(<LockoutHistoryPanel />);

    const line = await screen.findByText(/Last ran/);
    expect(line.textContent).toContain("1 admin deactivated");
    expect(line.textContent).not.toContain("1 admins");
  });
});
