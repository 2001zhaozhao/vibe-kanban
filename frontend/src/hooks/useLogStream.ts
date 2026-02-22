import { useEffect, useState, useRef } from 'react';
import type { PatchType } from 'shared/types';

type LogEntry = Extract<PatchType, { type: 'STDOUT' } | { type: 'STDERR' }>;

interface UseLogStreamResult {
  logs: LogEntry[];
  error: string | null;
}

export const useLogStream = (processId: string): UseLogStreamResult => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryCountRef = useRef<number>(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isIntentionallyClosed = useRef<boolean>(false);
  // Track current processId to prevent stale WebSocket messages from contaminating logs
  const currentProcessIdRef = useRef<string>(processId);

  useEffect(() => {
    if (!processId) {
      return;
    }

    // Update the ref to track the current processId
    currentProcessIdRef.current = processId;

    // Flag to track if this effect has been cleaned up (e.g. by React Strict
    // Mode unmounting immediately). Handlers check this so they become no-ops
    // after cleanup.
    let isCancelled = false;

    // Clear logs when process changes
    setLogs([]);
    setError(null);

    const open = () => {
      // Capture processId at the time of opening the WebSocket
      const capturedProcessId = processId;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const ws = new WebSocket(
        `${protocol}//${host}/api/execution-processes/${processId}/raw-logs/ws`
      );
      wsRef.current = ws;
      isIntentionallyClosed.current = false;

      ws.onopen = () => {
        // If the effect was already cleaned up (Strict Mode), close the now-
        // open socket cleanly instead of leaving it dangling.
        if (isCancelled) {
          ws.close();
          return;
        }
        // Ignore if processId has changed since WebSocket was opened
        if (currentProcessIdRef.current !== capturedProcessId) {
          ws.close();
          return;
        }
        setError(null);
        // Reset logs on new connection since server replays history
        setLogs([]);
        retryCountRef.current = 0;
      };

      const addLogEntry = (entry: LogEntry) => {
        // Only add log entry if this WebSocket is still for the current process
        if (isCancelled || currentProcessIdRef.current !== capturedProcessId) {
          return;
        }
        setLogs((prev) => [...prev, entry]);
      };

      // Handle WebSocket messages
      ws.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const data = JSON.parse(event.data);

          // Handle different message types based on LogMsg enum
          if ('JsonPatch' in data) {
            const patches = data.JsonPatch as Array<{ value?: PatchType }>;
            patches.forEach((patch) => {
              const value = patch?.value;
              if (!value || !value.type) return;

              switch (value.type) {
                case 'STDOUT':
                case 'STDERR':
                  addLogEntry({ type: value.type, content: value.content });
                  break;
                // Ignore other patch types (NORMALIZED_ENTRY, DIFF, etc.)
                default:
                  break;
              }
            });
          } else if (data.finished === true) {
            isIntentionallyClosed.current = true;
            ws.close();
          }
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };

      ws.onerror = () => {
        if (isCancelled) return;
        // Ignore errors from stale WebSocket connections
        if (currentProcessIdRef.current !== capturedProcessId) {
          return;
        }
        setError('Connection failed');
      };

      ws.onclose = (event) => {
        if (isCancelled) return;
        // Don't retry for stale WebSocket connections
        if (currentProcessIdRef.current !== capturedProcessId) {
          return;
        }
        // Only retry if the close was not intentional and not a normal closure
        if (!isIntentionallyClosed.current && event.code !== 1000) {
          const next = retryCountRef.current + 1;
          retryCountRef.current = next;
          if (next <= 6) {
            const delay = Math.min(1500, 250 * 2 ** (next - 1));
            retryTimerRef.current = setTimeout(() => open(), delay);
          }
        }
      };
    };

    open();

    return () => {
      isCancelled = true;

      if (wsRef.current) {
        isIntentionallyClosed.current = true;
        // Only close if the connection is already open. If still CONNECTING
        // (e.g. during React Strict Mode's immediate unmount), the onopen
        // handler above will close it once the handshake completes, avoiding
        // the "WebSocket is closed before the connection is established" warning.
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        }
        wsRef.current = null;
      }
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [processId]);

  return { logs, error };
};
