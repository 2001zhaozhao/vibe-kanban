import { useMemo, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLinkedIssueContext } from '@/shared/providers/remote/LinkedIssueContext';
import { buildIssuePath } from '@/shared/lib/routes/projectSidebarRoutes';
import { IssueSection } from '@vibe/ui/components/IssueSection';

export function IssueSectionContainer({
  projectId,
}: {
  projectId: string | undefined;
}) {
  const linkedIssue = useLinkedIssueContext();
  const navigate = useNavigate();

  const statusOptions = useMemo(() => {
    if (!linkedIssue?.statuses) return [];
    return linkedIssue.statuses
      .filter((s) => !s.hidden)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ value: s.id, label: s.name, color: s.color }));
  }, [linkedIssue?.statuses]);

  const handleStatusChange = useCallback(
    (statusId: string) => {
      linkedIssue?.updateIssue({ status_id: statusId });
    },
    [linkedIssue]
  );

  const handleNavigate = useCallback(() => {
    if (!projectId || !linkedIssue?.issue?.id) return;
    navigate(buildIssuePath(projectId, linkedIssue.issue.id));
  }, [navigate, projectId, linkedIssue?.issue?.id]);

  if (!linkedIssue?.issue) {
    return (
      <div className="flex items-center px-base py-half min-w-0">
        <span className="text-sm text-low">Loading issue…</span>
      </div>
    );
  }

  return (
    <IssueSection
      title={linkedIssue.issue.title}
      statusId={linkedIssue.issue.status_id}
      statusOptions={statusOptions}
      onStatusChange={handleStatusChange}
      onNavigate={handleNavigate}
    />
  );
}
