type AuthCallbackClient = {
  auth: {
    exchangeCodeForSession: (
      code: string,
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const DEFAULT_NEXT_PATH = "/parent/";

function safeNextPath(candidate: string | null) {
  if (!candidate?.startsWith("/") || candidate.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }
  return candidate;
}

export async function completeAuthCallback(
  client: AuthCallbackClient,
  currentUrl: URL,
) {
  const code = currentUrl.searchParams.get("code");
  if (!code) {
    throw new Error("Missing authentication code");
  }

  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    throw new Error(error.message);
  }

  return safeNextPath(currentUrl.searchParams.get("next"));
}
