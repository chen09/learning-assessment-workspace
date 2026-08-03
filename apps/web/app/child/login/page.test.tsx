import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildLoginPage from "@/app/child/login/page";

const mocks = vi.hoisted(() => ({
  createChildSession: vi.fn(),
}));

vi.mock("@/lib/api-client", () => mocks);

describe("ChildLoginPage", () => {
  beforeEach(() => {
    mocks.createChildSession.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "zh");
    window.history.replaceState(
      {},
      "",
      "/child/login/?childId=child-1",
    );
  });

  it("shows the complete PIN entry screen in the child's language", () => {
    render(<ChildLoginPage />);

    expect(
      screen.getByRole("heading", { name: "输入六位 PIN" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("家长可以在家庭设置中重置这个 PIN。"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("已输入 0/6 位数字"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "返回家长模式" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Enter your six-digit PIN")).not.toBeInTheDocument();
  });

  it("explains in the child's language when the saved session expired", async () => {
    window.localStorage.setItem("luma-language:demo-child", "ja");
    window.history.replaceState(
      {},
      "",
      "/child/login/?childId=child-1&expired=1&returnTo=%2Fchild%2Fwork%2F",
    );

    render(<ChildLoginPage />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "子どもセッションの有効期限が切れました。PIN をもう一度入力してください。",
    );
  });

  it("explains a temporary child PIN lock instead of reporting an ordinary wrong PIN", async () => {
    window.localStorage.setItem("luma-language:demo-child", "en");
    mocks.createChildSession.mockRejectedValue(
      new Error('{"detail":"Child entry is temporarily locked."}'),
    );

    render(<ChildLoginPage />);

    for (const digit of ["1", "2", "3", "4", "5", "6"]) {
      fireEvent.click(screen.getByRole("button", { name: digit }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Open my work" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many PIN attempts",
    );
    expect(screen.queryByText("That PIN did not work. Please try again.")).not.toBeInTheDocument();
  });

  it("clears an entered PIN and expired-session notice when browser navigation changes the child link", async () => {
    window.localStorage.setItem("luma-language:demo-child", "en");
    window.history.replaceState(
      {},
      "",
      "/child/login/?childId=child-1&expired=1",
    );

    render(<ChildLoginPage />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Your child session expired. Enter the PIN again to continue.",
    );
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(screen.getByLabelText("1 of 6 digits entered")).toBeInTheDocument();

    await act(async () => {
      window.history.pushState({}, "", "/child/login/?childId=child-2");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(
      screen.getByLabelText("0 of 6 digits entered"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
