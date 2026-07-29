import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChildHistoryPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...original,
    getChildAccessToken: vi.fn(() => null),
  };
});

describe("ChildHistoryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("luma-language:demo-child", "zh");
  });

  it("localizes history metadata while preserving worksheet titles", async () => {
    render(<ChildHistoryPage />);

    expect(
      await screen.findByRole("heading", { name: "学习记录" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("已完成的练习、分数和订正记录。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Algebra & English warm-up",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 道待订正")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.queryByText("Your work")).not.toBeInTheDocument();
  });
});
