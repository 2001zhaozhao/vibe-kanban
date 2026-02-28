import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { SidebarWorkspace } from '@/shared/hooks/useWorkspaces';

export function useAgentCompletionToast(workspaces: SidebarWorkspace[]) {
  const prevRunningIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    const currentRunningIds = new Set(
      workspaces.filter((w) => w.isRunning).map((w) => w.id)
    );

    if (!initializedRef.current) {
      initializedRef.current = true;
      prevRunningIdsRef.current = currentRunningIds;
      return;
    }

    // Find workspaces that were running but are no longer
    for (const id of prevRunningIdsRef.current) {
      if (!currentRunningIds.has(id)) {
        const workspace = workspaces.find((w) => w.id === id);
        if (workspace) {
          toast.info(`Agent finished in ${workspace.name}`);
        }
      }
    }

    prevRunningIdsRef.current = currentRunningIds;
  }, [workspaces]);
}
