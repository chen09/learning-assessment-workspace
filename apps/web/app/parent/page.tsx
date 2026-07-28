import type { Metadata } from "next";

import { ParentDashboard } from "@/components/parent-dashboard";

export const metadata: Metadata = {
  title: "Parent home",
};

export default function ParentPage() {
  return <ParentDashboard />;
}
