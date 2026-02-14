import { useEffect, useState, useRef } from 'react';
import { produce } from 'immer';
import type { Operation } from 'rfc6902';
import { applyUpsertPatch } from '@/utils/jsonPatch';

type WsJsonPatchMsg = { JsonPatch: Operation[] };
type WsReadyMsg = { Ready: true };
type WsFinishedMsg = { finished: boolean };
type WsMsg = WsJsonPatchMsg | WsReadyMsg | WsFinishedMsg;

interface UseJsonPatchStreamOptions<T> {
  /**
   * Called once when the stream starts to inject initial data
   */
  injectInitialEntry?: (data: T) => void;
  /**
   * Filter/deduplicate patches before applying them
   */
  deduplicatePatches?: (patches: Operation[]) => Operation[];
}

interface UseJsonPatchStreamResult<T> {
  data: T | undefined;
  isConnected: boolean;
  isInitialized: boolean;
  error: string | null;
}

/**
 * Generic hook for consuming WebSocket streams that send JSON messages with patches
 */
export const useJsonPatchWsStream = <T extends object>(
  endpoint: string | undefined,
  enabled: boolean,
  initialData: () => T,
  options?: UseJsonPatchStreamOptions<T>
): UseJsonPatchStreamResult<T> => {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dataRef = useRef<T | undefined>(undefined);
  const retryTimerRef = useRef<number | null>(null);
  const retryAttemptsRef = useRef<number>(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const finishedRef = useRef<boolean>(false);

  const injectInitialEntry = options?.injectInitialEntry;
  const deduplicatePatches = options?.deduplicatePatches;

  function scheduleReconnect() {
    if (retryTimerRef.current) return; // already scheduled
    // Exponential backoff with cap: 1s, 2s, 4s, 8s (max), then stay at 8s
    const attempt = retryAttemptsRef.current;
    const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setRetryNonce((n) => n + 1);
    }, delay);
  }

  useEffect(() => {
    if (!enabled || !endpoint) {
      // Close connection and reset state
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryAttemptsRef.current = 0;
      finishedRef.current = false;
      setData(undefined);
      setIsConnected(false);
      setIsInitialized(false);
      setError(null);
      dataRef.current = undefined;
      return;
    }

    // Flag to track if this effect has been cleaned up (e.g. by React Strict
    // Mode unmounting immediately). Handlers check this so they become no-ops
    // after cleanup, and the cleanup itself avoids calling ws.close() on a
    // socket that is still CONNECTING (which would log a browser warning).
    let isCancelled = false;

    // Initialize data
    if (!dataRef.current) {
      dataRef.current = initialData();

      // Inject initial entry if provided
      if (injectInitialEntry) {
        injectInitialEntry(dataRef.current);
      }
    }

    // Create WebSocket if it doesn't exist
    if (!wsRef.current) {
      // Reset finished flag for new connection
      finishedRef.current = false;

      // Convert HTTP endpoint to WebSocket endpoint
      const wsEndpoint = endpoint.replace(/^http/, 'ws');
      const ws = new WebSocket(wsEndpoint);

      ws.onopen = () => {
        // If the effect was already cleaned up (Strict Mode), close the now-
        // open socket cleanly instead of leaving it dangling.
        if (isCancelled) {
          ws.close();
          return;
        }
        setError(null);
        setIsConnected(true);
        // Reset backoff on successful connection
        retryAttemptsRef.current = 0;
        if (retryTimerRef.current) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      };

      ws.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const msg: WsMsg = JSON.parse(event.data);

          // Handle JsonPatch messages (same as SSE json_patch event)
          if ('JsonPatch' in msg) {
            const patches: Operation[] = msg.JsonPatch;
            const filtered = deduplicatePatches
              ? deduplicatePatches(patches)
              : patches;

            const current = dataRef.current;
            if (!filtered.length || !current) return;

            // Use Immer for structural sharing - only modified parts get new references
            const next = produce(current, (draft) => {
              applyUpsertPatch(draft, filtered);
            });

            dataRef.current = next;
            setData(next);
          }

          // Handle Ready messages (initial data has been sent)
          if ('Ready' in msg) {
            setIsInitialized(true);
          }

          // Handle finished messages ({finished: true})
          // Treat finished as terminal - do NOT reconnect
          if ('finished' in msg) {
            finishedRef.current = true;
            ws.close(1000, 'finished');
            wsRef.current = null;
            setIsConnected(false);
          }
        } catch (err) {
          console.error('Failed to process WebSocket message:', err);
          setError('Failed to process stream update');
        }
      };

      ws.onerror = () => {
        if (isCancelled) return;
        setError('Connection failed');
      };

      ws.onclose = (evt) => {
        if (isCancelled) return;
        setIsConnected(false);
        wsRef.current = null;

        // Do not reconnect if we received a finished message or clean close
        if (finishedRef.current || (evt?.code === 1000 && evt?.wasClean)) {
          return;
        }

        // Otherwise, reconnect on unexpected/error closures
        retryAttemptsRef.current += 1;
        scheduleReconnect();
      };

      wsRef.current = ws;
    }

    return () => {
      isCancelled = true;

      if (wsRef.current) {
        const ws = wsRef.current;

        // Only close if the connection is already open. If still CONNECTING
        // (e.g. during React Strict Mode's immediate unmount), the onopen
        // handler above will close it once the handshake completes, avoiding
        // the "WebSocket is closed before the connection is established" warning.
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      finishedRef.current = false;
      dataRef.current = undefined;
      setData(undefined);
      setIsInitialized(false);
    };
  }, [
    endpoint,
    enabled,
    initialData,
    injectInitialEntry,
    deduplicatePatches,
    retryNonce,
  ]);

  return { data, isConnected, isInitialized, error };
};
