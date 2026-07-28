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

const demoQuestions: ApiQuestion[] = [
  {
    id: "question-1",
    position: 1,
    type: "single_choice",
    prompt: "Choose the correct expansion of (a + b)(a − b).",
    options: ["a² − b²", "a² + b²", "a² − 2ab + b²"],
    points: 1,
  },
  {
    id: "question-2",
    position: 2,
    type: "typed_text",
    prompt: "Complete: She __________ to school every day.",
    options: null,
    points: 1,
  },
  {
    id: "question-3",
    position: 3,
    type: "handwriting",
    prompt: "Show why (a + b)(a − b) = a² − b².",
    options: null,
    points: 2,
  },
];

export default function PrintWorksheetPage() {
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [setCode, setSetCode] = useState("LA-DEMO-001");
  const [title, setTitle] = useState("Algebra & English warm-up");
  const [questions, setQuestions] = useState<ApiQuestion[]>(demoQuestions);

  useEffect(() => {
    const assignmentId =
      new URLSearchParams(window.location.search).get("assignmentId") ??
      "LA-DEMO-001";
    void QRCode.toDataURL(`luma-assignment:${assignmentId}`, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 160,
    }).then((dataUrl) => {
      setSetCode(assignmentId);
      setQrCode(dataUrl);
    });
    if (assignmentId !== "LA-DEMO-001") {
      void getParentAccessToken().then(async (parentToken) => {
        if (!parentToken) {
          return;
        }
        const printable = await getPrintableAssignment(
          assignmentId,
          parentToken,
        );
        setTitle(printable.title);
        setQuestions(printable.questions);
      });
    }
  }, []);

  return (
    <main className="print-preview">
      <header className="print-controls">
        <Link className="button ghost" href="/parent/create/">
          <ArrowLeft /> Back
        </Link>
        <p>Print on A4 at 100% scale. The QR code links scans to this assignment.</p>
        <button
          className="button primary"
          onClick={() => window.print()}
          type="button"
        >
          <Printer /> Print
        </button>
      </header>
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
    </main>
  );
}
