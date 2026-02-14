import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActions } from '@/contexts/ActionsContext';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useUserContext } from '@/contexts/remote/UserContext';
import { usePush } from '@/hooks/usePush';
import { useRenameBranch } from '@/hooks/useRenameBranch';
import { useBranchStatus } from '@/hooks/useBranchStatus';
import { ConfirmDialog } from '@/components/ui-new/dialogs/ConfirmDialog';
import { ForcePushDialog } from '@/components/dialogs/git/ForcePushDialog';
import { CommandBarDialog } from '@/components/ui-new/dialogs/CommandBarDialog';
import { GitPanel, type RepoInfo } from '@/components/ui-new/views/GitPanel';
import { Actions } from '@/components/ui-new/actions';
import { attemptsApi } from '@/lib/api';
import { makeRequest as remoteRequest } from '@/lib/remoteApi';
import { toast } from 'sonner';
import type { RepoAction } from '@/components/ui-new/primitives/RepoCard';
import type {
  Workspace,
  RepoWithTargetBranch,
  Merge,
  RepoBranchStatus,
} from 'shared/types';
import type { ProjectStatus } from 'shared/remote-types';

export interface GitPanelContainerProps {
  selectedWorkspace: Workspace | undefined;
  repos: RepoWithTargetBranch[];
}

type PushState = 'idle' | 'pending' | 'success' | 'error';

export function GitPanelContainer({
  selectedWorkspace,
  repos,
}: GitPanelContainerProps) {
  const { executeAction } = useActions();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const queryClient = useQueryClient();

  // Hooks for branch management (moved from WorkspacesLayout)
  const renameBranch = useRenameBranch(selectedWorkspace?.id);
  const { data: branchStatus } = useBranchStatus(selectedWorkspace?.id);

  // Get PR info from workspace summary (available immediately, no git calls needed)
  const summaryPr = useMemo(() => {
    if (!selectedWorkspace?.id) return undefined;
    const ws =
      activeWorkspaces.find((w) => w.id === selectedWorkspace.id) ??
      archivedWorkspaces.find((w) => w.id === selectedWorkspace.id);
    if (!ws?.prStatus || !ws.prNumber) return undefined;
    return {
      prNumber: ws.prNumber,
      prUrl: ws.prUrl,
      prStatus: ws.prStatus,
    };
  }, [selectedWorkspace?.id, activeWorkspaces, archivedWorkspaces]);

  const handleBranchNameChange = useCallback(
    (newName: string) => {
      renameBranch.mutate(newName);
    },
    [renameBranch]
  );

  // Transform repos to RepoInfo format (moved from WorkspacesLayout)
  // Uses workspace summary PR data as a fast fallback before branchStatus loads
  const repoInfos: RepoInfo[] = useMemo(
    () =>
      repos.map((repo) => {
        const repoStatus = branchStatus?.find((s) => s.repo_id === repo.id);

        let prNumber: number | undefined;
        let prUrl: string | undefined;
        let prStatus: 'open' | 'merged' | 'closed' | 'unknown' | undefined;

        if (repoStatus?.merges) {
          const openPR = repoStatus.merges.find(
            (m: Merge) => m.type === 'pr' && m.pr_info.status === 'open'
          );
          const mergedPR = repoStatus.merges.find(
            (m: Merge) => m.type === 'pr' && m.pr_info.status === 'merged'
          );

          const relevantPR = openPR || mergedPR;
          if (relevantPR && relevantPR.type === 'pr') {
            prNumber = Number(relevantPR.pr_info.number);
            prUrl = relevantPR.pr_info.url;
            prStatus = relevantPR.pr_info.status;
          }
        } else if (summaryPr) {
          // Use workspace summary PR data as a fast fallback while branchStatus loads.
          // The summary is fetched from the DB (no git calls) and is already cached.
          prNumber = summaryPr.prNumber;
          prUrl = summaryPr.prUrl;
          prStatus = summaryPr.prStatus;
        }

        return {
          id: repo.id,
          name: repo.display_name || repo.name,
          targetBranch: repo.target_branch || 'main',
          commitsAhead: repoStatus?.commits_ahead ?? 0,
          commitsBehind: repoStatus?.commits_behind ?? 0,
          remoteCommitsAhead: repoStatus?.remote_commits_ahead ?? 0,
          prNumber,
          prUrl,
          prStatus,
          isTargetRemote: repoStatus?.is_target_remote ?? false,
        };
      }),
    [repos, branchStatus, summaryPr]
  );

  // Track push state per repo: idle, pending, success, or error
  const [pushStates, setPushStates] = useState<Record<string, PushState>>({});
  const pushStatesRef = useRef<Record<string, PushState>>({});
  pushStatesRef.current = pushStates;
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPushRepoRef = useRef<string | null>(null);

  // Reset push-related state when the selected workspace changes to avoid
  // leaking push state across workspaces with repos that share the same ID.
  useEffect(() => {
    setPushStates({});
    pushStatesRef.current = {};
    currentPushRepoRef.current = null;

    if (successTimeoutRef.current) {
      clearTimeout(successTimeoutRef.current);
      successTimeoutRef.current = null;
    }
  }, [selectedWorkspace?.id]);
  // Use push hook for direct API access with proper error handling
  const pushMutation = usePush(
    selectedWorkspace?.id,
    // onSuccess
    () => {
      const repoId = currentPushRepoRef.current;
      if (!repoId) return;
      setPushStates((prev) => ({ ...prev, [repoId]: 'success' }));
      // Clear success state after 2 seconds
      successTimeoutRef.current = setTimeout(() => {
        setPushStates((prev) => ({ ...prev, [repoId]: 'idle' }));
      }, 2000);
    },
    // onError
    async (err, errorData) => {
      const repoId = currentPushRepoRef.current;
      if (!repoId) return;

      // Handle force push required - show confirmation dialog
      if (errorData?.type === 'force_push_required' && selectedWorkspace?.id) {
        setPushStates((prev) => ({ ...prev, [repoId]: 'idle' }));
        await ForcePushDialog.show({
          attemptId: selectedWorkspace.id,
          repoId,
        });
        return;
      }

      // Show error state and dialog for other errors
      setPushStates((prev) => ({ ...prev, [repoId]: 'error' }));
      const message =
        err instanceof Error ? err.message : 'Failed to push changes';
      ConfirmDialog.show({
        title: 'Error',
        message,
        confirmText: 'OK',
        showCancelButton: false,
        variant: 'destructive',
      });
      // Clear error state after 3 seconds
      successTimeoutRef.current = setTimeout(() => {
        setPushStates((prev) => ({ ...prev, [repoId]: 'idle' }));
      }, 3000);
    }
  );

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  // Compute repoInfos with push button state
  const repoInfosWithPushButton = useMemo(
    () =>
      repoInfos.map((repo) => {
        const state = pushStates[repo.id] ?? 'idle';
        const hasUnpushedCommits =
          repo.prStatus === 'open' && (repo.remoteCommitsAhead ?? 0) > 0;
        // Show push button if there are unpushed commits OR if we're in a push flow
        // (pending/success/error states keep the button visible for feedback)
        const isInPushFlow = state !== 'idle';
        return {
          ...repo,
          showPushButton: hasUnpushedCommits && !isInPushFlow,
          isPushPending: state === 'pending',
          isPushSuccess: state === 'success',
          isPushError: state === 'error',
        };
      }),
    [repoInfos, pushStates]
  );

  // ---- Merge All / Merge All & Complete ----
  const userCtx = useUserContext();

  const remoteWorkspace = useMemo(() => {
    if (!selectedWorkspace?.id || !userCtx?.workspaces) return undefined;
    return userCtx.workspaces.find(
      (w) => w.local_workspace_id === selectedWorkspace.id
    );
  }, [selectedWorkspace?.id, userCtx?.workspaces]);

  const hasLinkedKanbanTask = !!remoteWorkspace?.issue_id;

  const mergeableRepos = useMemo(() => {
    return repoInfosWithPushButton.filter((repo) => {
      return (
        repo.commitsAhead > 0 &&
        repo.prStatus !== 'open' &&
        !repo.isTargetRemote
      );
    });
  }, [repoInfosWithPushButton]);

  const hasMergeableRepos = mergeableRepos.length > 0;

  const [isMergeAllPending, setIsMergeAllPending] = useState(false);

  // Optimistically update the branchStatus cache so buttons reflect
  // the post-merge state immediately without waiting for the next poll.
  const clearMergedCommitsAhead = useCallback(
    (mergedRepoIds: string[]) => {
      if (!selectedWorkspace?.id) return;
      const ids = new Set(mergedRepoIds);
      queryClient.setQueryData<RepoBranchStatus[]>(
        ['branchStatus', selectedWorkspace.id],
        (old) =>
          old?.map((s) =>
            ids.has(s.repo_id) ? { ...s, commits_ahead: 0 } : s
          )
      );
    },
    [selectedWorkspace?.id, queryClient]
  );

  const handleMergeAll = useCallback(async () => {
    if (!selectedWorkspace?.id || isMergeAllPending) return;
    if (mergeableRepos.length === 0) {
      ConfirmDialog.show({
        title: 'Nothing to Merge',
        message:
          'No branches are eligible for merging. Repos must have commits ahead, no open PR, and not target a remote branch.',
        confirmText: 'OK',
        showCancelButton: false,
      });
      return;
    }
    setIsMergeAllPending(true);
    try {
      for (const repo of mergeableRepos) {
        await attemptsApi.merge(selectedWorkspace.id, { repo_id: repo.id });
      }
      clearMergedCommitsAhead(mergeableRepos.map((r) => r.id));
      toast.success('All branches merged successfully');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to merge all branches';
      ConfirmDialog.show({
        title: 'Merge Failed',
        message,
        confirmText: 'OK',
        showCancelButton: false,
        variant: 'destructive',
      });
    } finally {
      setIsMergeAllPending(false);
    }
  }, [selectedWorkspace?.id, isMergeAllPending, mergeableRepos, clearMergedCommitsAhead]);

  const handleMergeAllAndComplete = useCallback(async () => {
    if (!selectedWorkspace?.id || isMergeAllPending) return;
    if (mergeableRepos.length === 0) {
      ConfirmDialog.show({
        title: 'Nothing to Merge',
        message:
          'No branches are eligible for merging. Repos must have commits ahead, no open PR, and not target a remote branch.',
        confirmText: 'OK',
        showCancelButton: false,
      });
      return;
    }
    if (!remoteWorkspace?.issue_id || !remoteWorkspace?.project_id) return;

    setIsMergeAllPending(true);
    try {
      // 1. Merge all repos
      for (const repo of mergeableRepos) {
        await attemptsApi.merge(selectedWorkspace.id, { repo_id: repo.id });
      }
      clearMergedCommitsAhead(mergeableRepos.map((r) => r.id));

      // 2. Move Kanban issue to "Done"
      try {
        const statusesRes = await remoteRequest(
          `/v1/project_statuses?project_id=${remoteWorkspace.project_id}`
        );
        if (!statusesRes.ok) {
          console.warn(
            'Failed to fetch project statuses:',
            statusesRes.status
          );
          throw new Error('Failed to fetch project statuses');
        }
        const body = await statusesRes.json();
        const statuses: ProjectStatus[] = body.project_statuses ?? [];

        // Prefer a column named "Done", fall back to rightmost column
        const doneStatus =
          statuses.find((s) => s.name.toLowerCase() === 'done') ??
          statuses
            .filter((s) => !s.hidden)
            .sort((a, b) => b.sort_order - a.sort_order)[0];

        if (doneStatus) {
          const patchRes = await remoteRequest(
            `/v1/issues/${remoteWorkspace.issue_id}`,
            {
              method: 'PATCH',
              body: JSON.stringify({ status_id: doneStatus.id }),
            }
          );
          if (!patchRes.ok) {
            console.warn(
              'Failed to update issue status:',
              patchRes.status
            );
            throw new Error('Failed to update issue status');
          }
        }
        toast.success('Branches merged and issue marked as Done');
      } catch (kanbanErr) {
        // Non-fatal: merges succeeded, but couldn't update Kanban status
        console.warn('Failed to update Kanban issue status to Done', kanbanErr);
        toast.warning(
          'Branches merged, but could not update Kanban status'
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to merge all branches';
      ConfirmDialog.show({
        title: 'Merge Failed',
        message,
        confirmText: 'OK',
        showCancelButton: false,
        variant: 'destructive',
      });
    } finally {
      setIsMergeAllPending(false);
    }
  }, [
    selectedWorkspace?.id,
    isMergeAllPending,
    mergeableRepos,
    remoteWorkspace,
    clearMergedCommitsAhead,
  ]);

  // Handle opening command bar for repo actions
  const handleMoreClick = useCallback(
    (repoId: string) => {
      CommandBarDialog.show({
        page: 'repoActions',
        workspaceId: selectedWorkspace?.id,
        repoId,
      });
    },
    [selectedWorkspace?.id]
  );

  // Handle GitPanel actions using the action system
  const handleActionsClick = useCallback(
    async (repoId: string, action: RepoAction) => {
      if (!selectedWorkspace?.id) return;

      // Map RepoAction to Action definitions
      const actionMap = {
        'pull-request': Actions.GitCreatePR,
        merge: Actions.GitMerge,
        rebase: Actions.GitRebase,
        'change-target': Actions.GitChangeTarget,
        push: Actions.GitPush,
      };

      const actionDef = actionMap[action];
      if (!actionDef) return;

      // Execute git action with workspaceId and repoId
      await executeAction(actionDef, selectedWorkspace.id, repoId);
    },
    [selectedWorkspace, executeAction]
  );

  // Handle push button click - use mutation for proper state tracking
  const handlePushClick = useCallback(
    (repoId: string) => {
      // Use ref to check current state to avoid stale closure
      if (pushStatesRef.current[repoId] === 'pending') return;

      // Clear any existing timeout
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }

      // Track which repo we're pushing
      currentPushRepoRef.current = repoId;
      setPushStates((prev) => ({ ...prev, [repoId]: 'pending' }));
      pushMutation.mutate({ repo_id: repoId });
    },
    [pushMutation]
  );

  return (
    <GitPanel
      repos={repoInfosWithPushButton}
      workingBranchName={selectedWorkspace?.branch ?? ''}
      onWorkingBranchNameChange={handleBranchNameChange}
      onActionsClick={handleActionsClick}
      onPushClick={handlePushClick}
      onMoreClick={handleMoreClick}
      onAddRepo={() => console.log('Add repo clicked')}
      onMergeAll={handleMergeAll}
      onMergeAllAndComplete={handleMergeAllAndComplete}
      hasLinkedKanbanTask={hasLinkedKanbanTask}
      isMergeAllPending={isMergeAllPending}
      hasMergeableRepos={hasMergeableRepos}
    />
  );
}
