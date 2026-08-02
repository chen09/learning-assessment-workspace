"use client";

import katex from "katex";
import { Fragment } from "react";

type MathSegment =
  | { content: string; kind: "text" }
  | { content: string; kind: "inline" | "display" };

const MATH_DELIMITER = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g;

function parseMathSegments(value: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let cursor = 0;

  for (const match of value.matchAll(MATH_DELIMITER)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) {
      segments.push({ content: value.slice(cursor, matchIndex), kind: "text" });
    }

    const isDisplay = match[1] !== undefined;
    const content = (isDisplay ? match[1] : match[2]).trim();
    if (content) {
      segments.push({ content, kind: isDisplay ? "display" : "inline" });
    } else {
      segments.push({ content: match[0], kind: "text" });
    }
    cursor = matchIndex + match[0].length;
  }

  if (cursor < value.length || segments.length === 0) {
    segments.push({ content: value.slice(cursor), kind: "text" });
  }

  return segments;
}

function typeset(tex: string, displayMode: boolean) {
  return katex.renderToString(tex, {
    displayMode,
    output: "htmlAndMathml",
    strict: "warn",
    throwOnError: false,
    trust: false,
  });
}

/**
 * Renders the LaTex delimiters accepted by question imports:
 * inline `\\(...\\)` and display `\\[...\\]`.
 * Text without a complete delimiter stays untouched for backwards compatibility.
 */
export function MathText({ children }: { children: string }) {
  return (
    <>
      {parseMathSegments(children).map((segment, index) => {
        if (segment.kind === "text") {
          return <Fragment key={index}>{segment.content}</Fragment>;
        }

        return (
          <span
            className={
              segment.kind === "display" ? "math-text-display" : "math-text-inline"
            }
            dangerouslySetInnerHTML={{
              __html: typeset(segment.content, segment.kind === "display"),
            }}
            key={`${segment.kind}:${index}`}
          />
        );
      })}
    </>
  );
}
