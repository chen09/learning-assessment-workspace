import type { Metadata } from "next";

import { WorksheetWorkbench } from "@/components/worksheet-workbench";

export const metadata: Metadata = {
  title: "Today’s worksheet",
};

export default function ChildWorkPage() {
  return <WorksheetWorkbench />;
}
