"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { LanguageProvider, useLanguage } from "@/components/language-provider";
import {
  type ApiQuestion,
  getParentAccessToken,
  getPrintableAssignment,
} from "@/lib/api-client";

type LoadState = "loading" | "ready" | "missing" | "error";

type PrintablePage = {
  questions: ApiQuestion[];
};

// The inner A4 height has to leave room for the title block and footer. Keep
// handwriting deliberately conservative so a browser never splits its answer
// lines across pages when parents print at 100% scale.
const PAGE_CAPACITY = 54;

function questionFootprint(question: ApiQuestion) {
  if (question.type === "handwriting" || question.type === "photo") {
    return 18;
  }

  if (question.options) {
    return 8 + question.options.length * 2;
  }

  return 10;
}

function splitIntoPrintablePages(questions: ApiQuestion[]): PrintablePage[] {
  const pages: PrintablePage[] = [];
  let page: ApiQuestion[] = [];
  let usedCapacity = 0;

  for (const question of questions) {
    const footprint = questionFootprint(question);
    if (page.length > 0 && usedCapacity + footprint > PAGE_CAPACITY) {
      pages.push({ questions: page });
      page = [];
      usedCapacity = 0;
    }
    page.push(question);
    usedCapacity += footprint;
  }

  if (page.length > 0) {
    pages.push({ questions: page });
  }

  return pages;
}

function answerLineCount(question: ApiQuestion) {
  return question.type === "handwriting" || question.type === "photo" ? 4 : 2;
}

export default function PrintWorksheetPage() {
  return (
    <LanguageProvider storageKey="demo-parent">
      <PrintWorksheetContent />
    </LanguageProvider>
  );
}

function PrintWorksheetContent() {
  const { t } = useLanguage();
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [setCode, setSetCode] = useState("");
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadRequest, setLoadRequest] = useState(0);
  const printablePages = splitIntoPrintablePages(questions);

  useEffect(() => {
    let active = true;
    const assignmentId = new URLSearchParams(window.location.search).get(
      "assignmentId",
    );
    if (!assignmentId) {
      queueMicrotask(() => {
        if (active) {
          setLoadState("missing");
        }
      });
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const parentToken = await getParentAccessToken();
        if (!parentToken) {
          if (active) {
            setLoadState("error");
          }
          return;
        }
        const printable = await getPrintableAssignment(
          assignmentId,
          parentToken,
        );
        const dataUrl = await QRCode.toDataURL(
          `luma-assignment:${assignmentId}`,
          {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 160,
          },
        );
        if (active) {
          setSetCode(assignmentId);
          setTitle(printable.title);
          setQuestions(printable.questions);
          setQrCode(dataUrl);
          setLoadState("ready");
        }
      } catch {
        if (active) {
          setLoadState("error");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [loadRequest]);

  const retryLoad = () => {
    setLoadState("loading");
    setQrCode(null);
    setSetCode("");
    setTitle("");
    setQuestions([]);
    setLoadRequest((current) => current + 1);
  };

  return (
    <main className="print-preview">
      <header className="print-controls">
        <Link className="button ghost" href="/parent/create/">
          <ArrowLeft /> {t("print.back")}
        </Link>
        <p>{t("print.instructions")}</p>
        <div className="print-actions">
          <LanguageSwitcher />
          <button
            className="button primary"
            disabled={loadState !== "ready"}
            onClick={() => window.print()}
            type="button"
          >
            <Printer /> {t("print.action")}
          </button>
        </div>
      </header>
      {loadState === "loading" ? (
        <section className="a4-sheet">
          <h1>{t("print.loadingTitle")}</h1>
          <p>{t("print.loadingDescription")}</p>
        </section>
      ) : null}
      {loadState === "missing" ? (
        <section className="a4-sheet">
          <h1>{t("print.missingTitle")}</h1>
          <p>{t("print.missingDescription")}</p>
        </section>
      ) : null}
      {loadState === "error" ? (
        <section className="a4-sheet">
          <h1>{t("print.errorTitle")}</h1>
          <p>{t("print.errorDescription")}</p>
          <button className="button primary" onClick={retryLoad} type="button">
            {t("history.retry")}
          </button>
        </section>
      ) : null}
      {loadState === "ready" ? (
        printablePages.map((page, pageIndex) => (
          <article
            className="a4-sheet"
            data-page-number={pageIndex + 1}
            data-template-version="a4-v1"
            key={`print-page-${pageIndex + 1}`}
          >
            <div className="registration-mark top-left" />
            <div className="registration-mark top-right" />
            <header>
              <div>
                <p>{t("print.brand")}</p>
                <h1>{title}</h1>
              </div>
              <div
                aria-label={t("print.qrCode")}
                className="qr-placeholder"
                role="img"
                style={
                  qrCode
                    ? {
                        backgroundImage: `url(${qrCode})`,
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                        backgroundSize: "contain",
                      }
                    : undefined
                }
              >
                {qrCode ? null : "▦"}
              </div>
            </header>
            <div className="paper-meta">
              <span>{t("print.name")}: ____________________</span>
              <span>{t("print.date")}: ____________________</span>
            </div>
            {page.questions.map((question) => (
              <section
                className="paper-question"
                data-answer-page={pageIndex + 1}
                data-answer-region={question.id}
                key={question.id}
              >
                <span>{question.position}</span>
                <div>
                  <h2>{question.prompt}</h2>
                  {question.options?.map((option, index) => (
                    <p key={option}>
                      ○ {String.fromCharCode(65 + index)} &nbsp; {option}
                    </p>
                  ))}
                  {!question.options ? (
                    <div className="paper-lines">
                      {Array.from(
                        { length: answerLineCount(question) },
                        (_, index) => (
                          <i key={index} />
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            ))}
            <footer>
              {t("print.pageFooter", {
                set: setCode,
                page: pageIndex + 1,
                total: printablePages.length,
                version: "a4-v1",
              })}
            </footer>
            <div className="registration-mark bottom-left" />
            <div className="registration-mark bottom-right" />
          </article>
        ))
      ) : null}
    </main>
  );
}
