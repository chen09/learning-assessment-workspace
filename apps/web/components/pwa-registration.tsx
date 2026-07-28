"use client";

import { useEffect } from "react";

import { purgeExpiredDrafts } from "@/lib/draft-queue";

export function PwaRegistration() {
  useEffect(() => {
    void purgeExpiredDrafts().catch(() => undefined);
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
    }
  }, []);

  return null;
}
