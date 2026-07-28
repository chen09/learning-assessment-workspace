import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  LanguageProvider,
  useLanguage,
} from "@/components/language-provider";

function LanguageProbe() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div>
      <output>{language}</output>
      <span>{t("nav.home")}</span>
      <button onClick={() => setLanguage("ja")} type="button">
        日本語
      </button>
    </div>
  );
}

describe("LanguageProvider", () => {
  it("switches language and persists the member preference", () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "日本語" }));

    expect(screen.getByText("ホーム")).toBeInTheDocument();
    expect(screen.getByText("ja")).toBeInTheDocument();
    expect(window.localStorage.getItem("luma-language:public")).toBe("ja");
  });
});
