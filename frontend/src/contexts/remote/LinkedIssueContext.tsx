import { useContext, useMemo, useCallback, type ReactNode } from 'react';
import { createHmrContext } from '@/lib/hmrContext.ts';
import { useShape, type MutationResult } from '@/lib/electric/hooks';
import {
  SINGLE_ISSUE_SHAPE,
  PROJECT_PROJECT_STATUSES_SHAPE,
  ISSUE_MUTATION,
  type Issue,
  type ProjectStatus,
  type UpdateIssueRequest,
} from 'shared/remote-types';
import { useAuth } from '@/hooks/auth/useAuth';

/**
 * LinkedIssueContext syncs exactly one issue and its project's statuses.
 *
 * This is a lightweight context (2 SSE streams when enabled, 0 when disabled)
 * designed for the git panel's "Complete" button to know the current issue
 * status in real time without fetching the entire project board.
 *
 * --- Future integration ideas ---
 *
 * Because this context provides a live, optimistically-updatable view of the
 * linked kanban issue and its project statuses, any sidebar component can
 * `useLinkedIssueContext()` to build workspace ↔ kanban integrations:
 *
 * - **Status badge**: Show the issue's current column (e.g. "In Progress")
 *   next to the workspace name using `issue.status_id` + `statuses`.
 * - **Priority / due-date warnings**: Read `issue.priority` or
 *   `issue.target_date` to surface at-a-glance alerts in the sidebar.
 * - **Inline field editing**: Use `updateIssue()` to let users change the
 *   issue title, description, or priority without leaving the workspace.
 * - **Automated transitions**: Trigger `updateIssue({ status_id })` from
 *   CI/CD hooks (e.g. move to "In Review" when a PR is opened).
 * - **Assignee display**: Extend the provider to sync issue assignees via
 *   a scoped shape and show avatars in the sidebar header.
 */
export interface LinkedIssueContextValue {
  /** The synced issue, or undefined if not yet loaded / not linked */
  issue: Issue | undefined;
  /** All statuses for the issue's project */
  statuses: ProjectStatus[];
  /** The "Done" status column (prefers name "Done", falls back to rightmost visible) */
  doneStatus: ProjectStatus | undefined;
  /** Whether the issue is already in the done column */
  isIssueAlreadyDone: boolean;
  /** Whether the shapes are still loading */
  isLoading: boolean;
  /** Optimistic update for the issue */
  updateIssue: (data: Partial<UpdateIssueRequest>) => MutationResult;
  /** sort_order to place an issue at the top of the Done column */
  doneTopSortOrder: number;
}

export const LinkedIssueContext =
  createHmrContext<LinkedIssueContextValue | null>('LinkedIssueContext', null);

interface LinkedIssueProviderProps {
  /** The issue ID to sync, or null/undefined to disable */
  issueId: string | null | undefined;
  /** The project ID (needed for statuses), or null/undefined to disable */
  projectId: string | null | undefined;
  children: ReactNode;
}

export function LinkedIssueProvider({
  issueId,
  projectId,
  children,
}: LinkedIssueProviderProps) {
  const { isSignedIn } = useAuth();

  const issueEnabled = isSignedIn && !!issueId;
  const statusesEnabled = isSignedIn && !!projectId;

  const issueParams = useMemo(() => ({ issue_id: issueId ?? '' }), [issueId]);

  const statusesParams = useMemo(
    () => ({ project_id: projectId ?? '' }),
    [projectId]
  );

  // Sync the single issue (with mutation support for optimistic updates)
  const issueResult = useShape(SINGLE_ISSUE_SHAPE, issueParams, {
    enabled: issueEnabled,
    mutation: ISSUE_MUTATION,
  });

  // Sync project statuses (read-only)
  const statusesResult = useShape(
    PROJECT_PROJECT_STATUSES_SHAPE,
    statusesParams,
    { enabled: statusesEnabled }
  );

  const issue = issueResult.data[0] as Issue | undefined;
  const statuses = statusesResult.data;

  const doneStatus = useMemo(() => {
    if (statuses.length === 0) return undefined;
    // Prefer a column named "Done", fall back to rightmost visible column
    return (
      statuses.find((s) => s.name.toLowerCase() === 'done') ??
      statuses
        .filter((s) => !s.hidden)
        .sort((a, b) => b.sort_order - a.sort_order)[0]
    );
  }, [statuses]);

  const isIssueAlreadyDone = !!(
    issue &&
    doneStatus &&
    issue.status_id === doneStatus.id
  );

  const doneColumnIndex = useMemo(() => {
    if (!doneStatus) return 1;
    const visible = statuses
      .filter((s) => !s.hidden)
      .sort((a, b) => a.sort_order - b.sort_order);
    const idx = visible.findIndex((s) => s.id === doneStatus.id);
    return idx === -1 ? 1 : idx + 1;
  }, [statuses, doneStatus]);

  const doneTopSortOrder = doneColumnIndex * 1000;

  const isLoading = issueResult.isLoading || statusesResult.isLoading;

  const updateIssue = useCallback(
    (data: Partial<UpdateIssueRequest>): MutationResult => {
      if (!issue) {
        return { persisted: Promise.resolve() };
      }
      return issueResult.update(issue.id, data);
    },
    [issue, issueResult]
  );

  const value = useMemo<LinkedIssueContextValue>(
    () => ({
      issue,
      statuses,
      doneStatus,
      isIssueAlreadyDone,
      isLoading,
      updateIssue,
      doneTopSortOrder,
    }),
    [
      issue,
      statuses,
      doneStatus,
      isIssueAlreadyDone,
      isLoading,
      updateIssue,
      doneTopSortOrder,
    ]
  );

  return (
    <LinkedIssueContext.Provider value={value}>
      {children}
    </LinkedIssueContext.Provider>
  );
}

/**
 * Hook to access the linked issue context.
 * Returns null when used outside a LinkedIssueProvider.
 *
 * Any component inside the RightSidebar tree can call this hook to read or
 * mutate the linked kanban issue. The provider is mounted in RightSidebar.tsx,
 * so future sidebar sections (e.g. a "Task Details" panel, a status picker,
 * or an activity feed) can consume it without any extra wiring.
 */
export function useLinkedIssueContext(): LinkedIssueContextValue | null {
  return useContext(LinkedIssueContext);
}
