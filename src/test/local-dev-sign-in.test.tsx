import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignIn } from "@/routes/auth";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  verify: vi.fn(),
  getSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  oauth: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => mocks.verify,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      signInWithPassword: mocks.signInWithPassword,
      signOut: mocks.signOut,
    },
  },
}));

vi.mock("@/integrations/lovable", () => ({
  lovable: { auth: { signInWithOAuth: mocks.oauth } },
}));

vi.mock("@/lib/reports.functions", () => ({ getMasterData: vi.fn() }));

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new URL(`http://${hostname}/auth`),
  });
}

describe("local developer sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", true);
    setHostname("localhost");
    mocks.navigate.mockReset();
    mocks.verify.mockReset().mockResolvedValue({});
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: null } });
    mocks.signInWithPassword.mockReset().mockResolvedValue({ error: null });
    mocks.signOut.mockReset();
    mocks.oauth.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renders on localhost in development", async () => {
    render(<SignIn />);
    expect(await screen.findByRole("heading", { name: "Developer sign-in" })).toBeInTheDocument();
    expect(screen.getByText("Google and Lovable sign-in only work on the Lovable-hosted app. Use developer sign-in locally.")).toBeInTheDocument();
  });

  it("does not render when DEV is false", async () => {
    vi.stubEnv("DEV", false);
    render(<SignIn />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Developer sign-in" })).not.toBeInTheDocument());
  });

  it("does not render on a non-local hostname", async () => {
    setHostname("fieldiq.example");
    render(<SignIn />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Developer sign-in" })).not.toBeInTheDocument());
  });

  it("signs in with the typed credentials, verifies the profile, then navigates home", async () => {
    render(<SignIn />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "mr@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in locally" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/", replace: true }));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "mr@example.test", password: "test-password" });
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });

  it("shows a development error after failed sign-in and does not verify or navigate", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: new Error("Email provider is disabled") });
    render(<SignIn />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "mr@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in locally" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in could not be completed");
    expect(await screen.findByText("Development detail: Email provider is disabled")).toBeInTheDocument();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
