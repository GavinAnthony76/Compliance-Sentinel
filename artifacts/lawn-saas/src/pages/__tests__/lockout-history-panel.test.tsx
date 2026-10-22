import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
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

  it("shows the last emailed alert next to the overdue warning", async () => {
    const lastRan = new Date();
    vi.useFakeTimers({ now: lastRan.getTime() + 80 * HOUR, toFake: ["Date"] });
    mockFetchWith({
      sweepEnabled: true,
      runs: [{ id: 1, ranAt: lastRan.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      lastAlert: { sentAt: "2026-07-20T09:00:00Z", recipients: 3 },
    });

    render(<LockoutHistoryPanel />);

    const alertLine = await screen.findByText(/Alert emailed to 3 admins on/);
    expect(alertLine.textContent).toContain("Jul 20, 2026");
    vi.useRealTimers();
  });

  it("does not show the alert line when the sweep is healthy", async () => {
    const lastRan = new Date();
    mockFetchWith({
      sweepEnabled: true,
      runs: [{ id: 1, ranAt: lastRan.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      lastAlert: { sentAt: "2026-07-20T09:00:00Z", recipients: 3 },
    });

    render(<LockoutHistoryPanel />);

    await screen.findByText(/Last ran/);
    expect(screen.queryByText(/Alert emailed/)).not.toBeInTheDocument();
  });

  it("shows the resolved incident when the sweep has recovered", async () => {
    const recoveredAt = new Date(Date.now() - 2 * HOUR);
    mockFetchWith({
      sweepEnabled: true,
      runs: [{ id: 2, ranAt: recoveredAt.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      lastRecovery: { recoveredAt: recoveredAt.toISOString(), alertSentAt: "2026-07-18T09:00:00Z", recipients: 2 },
    });

    render(<LockoutHistoryPanel />);

    const line = await screen.findByText(/Resolved: the sweep recovered on/);
    expect(line.textContent).toContain("Jul 18, 2026");
    expect(line.textContent).toContain("all-clear sent to 2 admins");
  });

  it("never shows a resolved line next to a current outage", async () => {
    const ranAt = new Date("2026-07-20T02:00:00Z");
    vi.useFakeTimers({ now: ranAt.getTime() + 80 * HOUR, toFake: ["Date"] });
    mockFetchWith({
      sweepEnabled: true,
      runs: [{ id: 1, ranAt: ranAt.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      lastRecovery: { recoveredAt: ranAt.toISOString(), alertSentAt: "2026-07-18T09:00:00Z", recipients: 2 },
    });

    render(<LockoutHistoryPanel />);

    await screen.findByText(/hasn't run in 3 days/);
    expect(screen.queryByText(/Resolved:/)).not.toBeInTheDocument();
    vi.useRealTimers();
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

  describe("overdue warning colors", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function renderWithLastRun(hoursAgo: number, sweepEnabled = true) {
      const ranAt = new Date("2026-07-20T02:00:00Z");
      vi.useFakeTimers({ now: ranAt.getTime() + hoursAgo * HOUR, toFake: ["Date"] });
      mockFetchWith({
        sweepEnabled,
        runs: [{ id: 1, ranAt: ranAt.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      });
      return render(<LockoutHistoryPanel />);
    }

    function panelContainer() {
      return screen.getByText("Automatic inactivity lockout").closest(".rounded-xl") as HTMLElement;
    }

    it("shows no warning and emerald styling under 36 hours", async () => {
      const { container } = renderWithLastRun(35);
      await screen.findByText(/Last ran/);

      expect(screen.queryByText(/hasn't run in/)).not.toBeInTheDocument();
      expect(panelContainer().className).toContain("border-slate-800");
      expect(panelContainer().className).not.toContain("amber");
      expect(panelContainer().className).not.toContain("red");
      expect(container.querySelector(".text-emerald-400")).not.toBeNull();
    });

    it("shows an amber border and warning text at 36 hours", async () => {
      renderWithLastRun(36);
      const warning = await screen.findByText(/hasn't run in 36 hours/);

      expect(warning.className).toContain("text-amber-400");
      expect(panelContainer().className).toContain("border-amber-500/50");
      expect(panelContainer().className).not.toContain("red");
    });

    it("shows a red border and 'days' phrasing at 72 hours", async () => {
      renderWithLastRun(72);
      const warning = await screen.findByText(/hasn't run in 3 days/);

      expect(warning.className).toContain("text-red-400");
      expect(panelContainer().className).toContain("border-red-500/50");
      expect(panelContainer().className).not.toContain("amber");
    });

    it("upgrades the warning as time passes while the tab stays open", async () => {
      const ranAt = new Date("2026-07-20T02:00:00Z");
      vi.useFakeTimers({
        now: ranAt.getTime() + 35 * HOUR,
        toFake: ["Date", "setInterval", "clearInterval"],
      });
      mockFetchWith({
        sweepEnabled: true,
        runs: [{ id: 1, ranAt: ranAt.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      });
      render(<LockoutHistoryPanel />);
      await screen.findByText(/Last ran/);

      // Healthy at 35h: no warning, emerald styling
      expect(screen.queryByText(/hasn't run in/)).not.toBeInTheDocument();
      expect(panelContainer().className).toContain("border-slate-800");

      // Cross the 36h amber threshold without any refetch or reload
      act(() => {
        vi.advanceTimersByTime(2 * HOUR);
      });
      expect(screen.getByText(/hasn't run in 37 hours/)).toBeInTheDocument();
      expect(panelContainer().className).toContain("border-amber-500/50");

      // Keep the tab open past the 72h red threshold
      act(() => {
        vi.advanceTimersByTime(40 * HOUR);
      });
      expect(screen.getByText(/hasn't run in 3 days/)).toBeInTheDocument();
      expect(panelContainer().className).toContain("border-red-500/50");
      expect(panelContainer().className).not.toContain("amber");
    });

    describe("auto-refresh while mounted", () => {
      const REFRESH = 5 * 60 * 1000;
      const ranAt = new Date("2026-07-20T02:00:00Z");
      const staleBody = {
        sweepEnabled: true,
        runs: [{ id: 1, ranAt: ranAt.toISOString(), deactivatedCount: 0, thresholdDays: 90 }],
      };

      function startOverdue() {
        vi.useFakeTimers({ now: ranAt.getTime() + 80 * HOUR, toFake: ["Date", "setInterval", "clearInterval"] });
      }

      it("clears the overdue warning when a new run appears, without a reload", async () => {
        startOverdue();
        const fetchMock = mockFetchWith(staleBody);
        render(<LockoutHistoryPanel />);
        await screen.findByText(/hasn't run in 3 days/);

        const freshRun = { id: 2, ranAt: new Date(Date.now() - HOUR).toISOString(), deactivatedCount: 1, thresholdDays: 90 };
        fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ sweepEnabled: true, runs: [freshRun, staleBody.runs[0]] }) }));
        await act(async () => {
          vi.advanceTimersByTime(REFRESH);
        });

        await waitFor(() => expect(screen.queryByText(/hasn't run in/)).not.toBeInTheDocument());
        expect(screen.getByText(/Last ran/).textContent).toContain("1 admin deactivated");
        expect(panelContainer().className).toContain("border-slate-800");
      });

      it("keeps the last history (still overdue) when a refresh fails — never falsely healthy", async () => {
        startOverdue();
        const fetchMock = mockFetchWith(staleBody);
        render(<LockoutHistoryPanel />);
        await screen.findByText(/hasn't run in 3 days/);

        fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
        await act(async () => {
          vi.advanceTimersByTime(REFRESH);
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(screen.getByText(/hasn't run in 3 days/)).toBeInTheDocument();
        expect(screen.queryByText("Couldn't load the sweep history right now.")).not.toBeInTheDocument();
        expect(panelContainer().className).toContain("border-red-500/50");
      });

      it("ignores a slow older response that resolves after a newer one", async () => {
        startOverdue();
        const fetchMock = mockFetchWith(staleBody);
        render(<LockoutHistoryPanel />);
        await screen.findByText(/hasn't run in 3 days/);

        // Refresh #1 hangs; refresh #2 brings a fresh run; then #1 resolves stale.
        let releaseSlow: () => void = () => {};
        fetchMock.mockImplementationOnce(() => new Promise((resolve) => {
          releaseSlow = () => resolve({ ok: true, status: 200, json: async () => staleBody } as any);
        }) as any);
        await act(async () => {
          vi.advanceTimersByTime(REFRESH);
        });
        const freshRun = { id: 2, ranAt: new Date(Date.now() - HOUR).toISOString(), deactivatedCount: 0, thresholdDays: 90 };
        fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ sweepEnabled: true, runs: [freshRun] }) }));
        await act(async () => {
          vi.advanceTimersByTime(REFRESH);
        });
        await waitFor(() => expect(screen.queryByText(/hasn't run in/)).not.toBeInTheDocument());

        await act(async () => {
          releaseSlow();
        });
        expect(screen.queryByText(/hasn't run in/)).not.toBeInTheDocument();
      });

      it("stops refreshing once unmounted", async () => {
        startOverdue();
        const fetchMock = mockFetchWith(staleBody);
        const { unmount } = render(<LockoutHistoryPanel />);
        await screen.findByText(/hasn't run in 3 days/);
        unmount();

        act(() => {
          vi.advanceTimersByTime(3 * REFRESH);
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    it("suppresses the overdue warning when the sweep is disabled, showing the turned-off note", async () => {
      renderWithLastRun(100, false);
      await screen.findByText(/Last ran/);

      expect(screen.queryByText(/hasn't run in/)).not.toBeInTheDocument();
      expect(screen.getByText("turned off")).toBeInTheDocument();
      expect(panelContainer().className).toContain("border-slate-700");
      expect(panelContainer().className).not.toContain("amber");
      expect(panelContainer().className).not.toContain("red");
    });
  });
});
