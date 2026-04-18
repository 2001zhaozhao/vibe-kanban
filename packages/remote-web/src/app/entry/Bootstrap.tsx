import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { AppRouter } from "@remote/app/entry/App";
import { RemoteAuthProvider } from "@remote/app/providers/RemoteAuthProvider";
import { getIdentity } from "@remote/shared/lib/api";
import { getToken, triggerRefresh } from "@remote/shared/lib/auth/tokenManager";
import "@remote/app/styles/index.css";
import "@/i18n";
import { configureAuthRuntime } from "@/shared/lib/auth/runtime";
import { setRemoteApiBase } from "@/shared/lib/remoteApi";
import { setRelayApiBase } from "@/shared/lib/relayBackendApi";
import { setLocalApiTransport } from "@/shared/lib/localApiTransport";
import "@/shared/types/modals";
import { queryClient } from "@/shared/lib/queryClient";
import {
  requestLocalApiViaWebRtc,
  openLocalApiWebSocketViaWebRtc,
} from "@remote/shared/lib/webrtc";

if (import.meta.env.VITE_PUBLIC_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_PUBLIC_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
  });
}

setRemoteApiBase(import.meta.env.VITE_API_BASE_URL || window.location.origin);
setRelayApiBase(
  import.meta.env.VITE_RELAY_API_BASE_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    window.location.origin,
);
setLocalApiTransport({
  request: requestLocalApiViaWebRtc,
  openWebSocket: openLocalApiWebSocketViaWebRtc,
});

configureAuthRuntime({
  getToken,
  triggerRefresh,
  registerShape: () => () => {},
  getCurrentUser: async () => {
    const identity = await getIdentity();
    return { user_id: identity.user_id };
  },
});

async function waitForHttp2(apiBase: string, maxWaitMs = 4000): Promise<void> {
  const probeUrl = `${apiBase}/v1/health`;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      await fetch(probeUrl, { method: "HEAD", cache: "no-store" });
      const entries = performance.getEntriesByName(
        probeUrl,
      ) as PerformanceResourceTiming[];
      const latest = entries[entries.length - 1];
      if (latest?.nextHopProtocol === "h2") return;
    } catch {
      // network error, keep trying
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  // Timed out — proceed anyway rather than blocking the app indefinitely
}

(async () => {
  const apiBase = import.meta.env.VITE_API_BASE_URL || window.location.origin;
  await waitForHttp2(apiBase);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <PostHogProvider client={posthog}>
          <RemoteAuthProvider>
            <AppRouter />
          </RemoteAuthProvider>
        </PostHogProvider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
})();
