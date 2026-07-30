"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

import {
  type ApiQuestion,
  getParentAccessToken,
  getPrintableAssignment,
} from "@/lib/api-client";

type LoadState = "loading" | "ready" | "missing" | "error";

export default function PrintWorksheetPage() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [setCode, setSetCode] = useState("");
  const [title, setTitle] = useState("");
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

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
  }, []);

  return (
    <main className="print-preview">
      <header className="print-controls">
        <Link className="button ghost" href="/parent/create/">
          <ArrowLeft /> Back
        </Link>
        <p>
          Print on A4 at 100% scale. The QR code links scans to this assignment.
        </p>
        <button
          className="button primary"
          disabled={loadState !== "ready"}
          onClick={() => window.print()}
          type="button"
        >
          <Printer /> Print
        </button>
      </header>
      {loadState === "loading" ? (
        <section className="a4-sheet">
          <h1>Loading printable assignment…</h1>
          <p>The worksheet will appear after its questions are loaded.</p>
        </section>
      ) : null}
      {loadState === "missing" ? (
        <section className="a4-sheet">
          <h1>No printable assignment selected</h1>
          <p>Open an assigned worksheet before using the print view.</p>
        </section>
      ) : null}
      {loadState === "error" ? (
        <section className="a4-sheet">
          <h1>Printable assignment could not be loaded</h1>
          <p>Return to the family workspace and try again.</p>
        </section>
      ) : null}
      {loadState === "ready" ? (
        <article className="a4-sheet" data-template-version="a4-v1">
          <div className="registration-mark top-left" />
          <div className="registration-mark top-right" />
          <header>
            <div>
              <p>LUMA FAMILY LEARNING</p>
              <h1>{title}</h1>
            </div>
            <div
              aria-label="Assignment QR code"
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
            <span>Name: ____________________</span>
            <span>Date: ____________________</span>
          </div>
          {questions.map((question) => (
            <section
              className="paper-question"
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
                      {
                        length: question.type === "handwriting" ? 4 : 2,
                      },
                      (_, index) => (
                        <i key={index} />
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            </section>
          ))}
          <footer>Set {setCode} · Page 1 / 1 · Template a4-v1</footer>
          <div className="registration-mark bottom-left" />
          <div className="registration-mark bottom-right" />
        </article>
      ) : null}
    </main>
  );
}
