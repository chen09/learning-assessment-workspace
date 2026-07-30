import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildLoginPage from "@/app/child/login/page";

vi.mock("@/lib/api-client", () => ({
  createChildSession: vi.fn(),
}));

describe("ChildLoginPage", () => {
  beforeEach(() => {
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
});
