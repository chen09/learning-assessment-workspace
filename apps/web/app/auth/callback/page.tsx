import type { Metadata } from "next";

import { AuthCallback } from "@/components/auth-callback";

export const metadata: Metadata = {
  title: "Completing sign in",
};

export default function AuthCallbackPage() {
  return <AuthCallback />;
}
