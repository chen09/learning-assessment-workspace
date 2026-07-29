import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExitChildModePage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getActiveChildProfile: vi.fn(() => null),
    getParentAccessToken: vi.fn(async () => null),
  };
});

describe("ExitChildModePage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "zh");
  });

  it("localizes the parent PIN check and its error state", async () => {
    render(<ExitChildModePage />);

    expect(
      await screen.findByRole("heading", {
        name: "输入家长管理 PIN",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "删除最后一位数字" }),
    ).toBeInTheDocument();

    const zero = screen.getByRole("button", { name: "0" });
    for (let index = 0; index < 6; index += 1) {
      fireEvent.click(zero);
    }
    fireEvent.click(
      screen.getByRole("button", { name: "返回家长模式" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "需要已登录的家长和正确的管理 PIN。",
    );
    expect(
      screen.queryByText("Enter your management PIN"),
    ).not.toBeInTheDocument();
  });
});
