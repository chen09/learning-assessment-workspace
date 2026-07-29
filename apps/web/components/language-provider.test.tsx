import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "en";
  });

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

  it("applies a stored preference to the document language", () => {
    window.localStorage.setItem("luma-language:public", "zh");

    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    expect(screen.getByText("zh")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("zh");
  });
});
