// VS Code webview integration - install keyboard/clipboard bridge
import '@/integrations/vscode/bridge';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from 'shared/types';
import { useTranslation } from 'react-i18next';
import { AppWithStyleOverride } from '@/shared/lib/StyleOverride';
import { useStyleOverrideThemeSetter } from '@/shared/lib/StyleOverride';
import { WebviewContextMenu } from '@/integrations/vscode/ContextMenu';
import { ArrowDownIcon } from '@phosphor-icons/react';
import {
  useWorkspaceContext,
  useWorkspaceDiffContext,
} from '@/shared/hooks/useWorkspaceContext';
import { usePageTitle } from '@/shared/hooks/usePageTitle';
import { SessionChatBoxContainer } from '@/features/workspace-chat/ui/SessionChatBoxContainer';
import { workspacesApi } from '@/shared/lib/api';
import { BaseCodingAgent, PermissionPolicy } from 'shared/types';
import { useProjectContextOptional } from '@/shared/hooks/useProjectContext';
import { useExecutionProcesses } from '@/shared/hooks/useExecutionProcesses';
import { getLatestConfigFromProcesses } from '@/shared/lib/executor';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import {
  ConversationList,
  type ConversationListHandle,
} from '@/features/workspace-chat/ui/ConversationListContainer';
import { EntriesProvider } from '@/features/workspace-chat/model/contexts/EntriesContext';
import { MessageEditProvider } from '@/features/workspace-chat/model/contexts/MessageEditContext';
import { RetryUiProvider } from '@/features/workspace-chat/model/contexts/RetryUiContext';
import { ApprovalFeedbackProvider } from '@/features/workspace-chat/model/contexts/ApprovalFeedbackContext';
import { createWorkspaceWithSession } from '@/shared/types/attempt';

function VSCodeChatBox({
  session,
  workspaceId,
  isNewSessionMode,
  sessions,
  onSelectSession,
  onStartNewSession,
  onScrollToPreviousMessage,
  onScrollToBottom,
}: {
  session: Session | undefined;
  workspaceId: string | undefined;
  isNewSessionMode: boolean;
  sessions: Session[];
  onSelectSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onScrollToPreviousMessage: () => void;
  onScrollToBottom: (behavior?: 'auto' | 'smooth') => void;
}) {
  const { diffStats } = useWorkspaceDiffContext();

  return (
    <SessionChatBoxContainer
      {...(isNewSessionMode && workspaceId
        ? {
            mode: 'new-session' as const,
            workspaceId,
            onSelectSession,
          }
        : session
          ? {
              mode: 'existing-session' as const,
              session,
              onSelectSession,
              onStartNewSession,
            }
          : {
              mode: 'placeholder' as const,
            })}
      sessions={sessions}
      filesChanged={diffStats.files_changed}
      linesAdded={diffStats.lines_added}
      linesRemoved={diffStats.lines_removed}
      disableViewCode
      showOpenWorkspaceButton={false}
      onScrollToPreviousMessage={onScrollToPreviousMessage}
      onScrollToBottom={onScrollToBottom}
    />
  );
}

export function VSCodeWorkspacePage() {
  const { t } = useTranslation('common');
  const setTheme = useStyleOverrideThemeSetter();
  const appNavigation = useAppNavigation();
  const mainContainerRef = useRef<HTMLElement>(null);
  const conversationListRef = useRef<ConversationListHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(isAtBottom);

  const {
    workspaceId,
    workspace,
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    isLoading,
    diffStats,
    repos,
    isNewSessionMode,
    startNewSession,
    repos,
  } = useWorkspaceContext();

  // Linked issue from remote project context (if available)
  const projectCtx = useProjectContextOptional();
  const linkedIssueForWorkspace = useMemo(() => {
    if (!projectCtx || !workspaceId) return null;
    const remoteWorkspace = projectCtx.workspaces.find(
      (w) => w.local_workspace_id === workspaceId
    );
    if (!remoteWorkspace?.issue_id) return null;
    return {
      remoteProjectId: projectCtx.projectId,
      issueId: remoteWorkspace.issue_id,
    };
  }, [projectCtx, workspaceId]);

  // Executor config from current session processes
  const { executionProcesses } = useExecutionProcesses(selectedSessionId);
  const latestExecutorConfig = useMemo(
    () => getLatestConfigFromProcesses(executionProcesses),
    [executionProcesses]
  );

  const handleClearContextAndAcceptPlan = useCallback(
    async (planText: string) => {
      if (!workspaceId || !repos.length) return;

      const prompt = planText
        ? `Implement the following plan that was approved by the user:\n\n${planText}`
        : 'Continue implementing the approved plan.';

      const newWorkspace = await workspacesApi.createAndStart({
        name: null,
        repos: repos.map((r) => ({
          repo_id: r.id,
          target_branch: r.target_branch,
        })),
        linked_issue: linkedIssueForWorkspace
          ? {
              remote_project_id: linkedIssueForWorkspace.remoteProjectId,
              issue_id: linkedIssueForWorkspace.issueId,
            }
          : null,
        executor_config: {
          ...(latestExecutorConfig ?? {
            executor: BaseCodingAgent.CLAUDE_CODE,
          }),
          permission_policy: PermissionPolicy.AUTO,
        },
        prompt,
        image_ids: null,
      });

      await workspacesApi.update(workspaceId, { archived: true });

      appNavigation.goToWorkspace(newWorkspace.workspace.id);
    },
    [
      workspaceId,
      repos,
      linkedIssueForWorkspace,
      latestExecutorConfig,
      appNavigation,
    ]
  );

  usePageTitle(workspace?.name);

  const workspaceWithSession = workspace
    ? createWorkspaceWithSession(workspace, selectedSession)
    : undefined;

  const handleScrollToPreviousMessage = () => {
    conversationListRef.current?.scrollToPreviousUserMessage();
  };

  const handleScrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      conversationListRef.current?.scrollToBottom(behavior);
    },
    []
  );

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    const container = mainContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const chatBoxContainer = container.querySelector<HTMLElement>(
      '[data-chatbox-container="true"]'
    );
    if (!chatBoxContainer) return;

    let previousHeight = chatBoxContainer.getBoundingClientRect().height;

    const observer = new ResizeObserver((entries) => {
      const nextHeight =
        entries[0]?.contentRect.height ??
        chatBoxContainer.getBoundingClientRect().height;

      if (Math.abs(nextHeight - previousHeight) < 0.5) return;
      const heightDelta = nextHeight - previousHeight;
      previousHeight = nextHeight;

      if (!isAtBottomRef.current) return;

      requestAnimationFrame(() => {
        if (!isAtBottomRef.current) return;
        conversationListRef.current?.adjustScrollBy(heightDelta);
      });
    });

    observer.observe(chatBoxContainer);

    return () => {
      observer.disconnect();
    };
  }, [workspaceWithSession?.id, selectedSession?.id]);

  return (
    <AppWithStyleOverride setTheme={setTheme}>
      <div className="h-screen flex flex-col bg-primary">
        <WebviewContextMenu />

        <main
          ref={mainContainerRef}
          className="relative flex flex-1 flex-col h-full min-h-0"
        >
          <ApprovalFeedbackProvider>
            <EntriesProvider
              key={
                workspaceWithSession
                  ? `${workspaceWithSession.id}-${selectedSessionId ?? 'new'}`
                  : 'empty'
              }
            >
              <MessageEditProvider>
                {isLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-low">{t('workspaces.loading')}</p>
                  </div>
                ) : !workspaceWithSession ? (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-low">{t('workspaces.notFound')}</p>
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-hidden flex justify-center">
                    <div className="w-chat max-w-full h-full">
                      <RetryUiProvider workspaceId={workspaceWithSession.id}>
                        <ConversationList
                          key={`${workspaceWithSession.id}-${selectedSessionId ?? 'new'}`}
                          ref={conversationListRef}
                          attempt={workspaceWithSession}
                          repos={repos}
                          onAtBottomChange={handleAtBottomChange}
                          sessionScopeId={selectedSessionId}
                        />
                      </RetryUiProvider>
                    </div>
                  </div>
                )}

                {workspaceWithSession && !isAtBottom && (
                  <div className="flex justify-center pointer-events-none">
                    <div className="w-chat max-w-full relative">
                      <button
                        type="button"
                        onClick={() => handleScrollToBottom('auto')}
                        className="absolute bottom-2 right-4 z-10 pointer-events-auto flex items-center justify-center size-8 rounded-full bg-secondary/80 backdrop-blur-sm border border-secondary text-low hover:text-normal hover:bg-secondary shadow-md transition-all"
                        aria-label="Scroll to bottom"
                        title="Scroll to bottom"
                      >
                        <ArrowDownIcon
                          className="size-icon-base"
                          weight="bold"
                        />
                      </button>
                    </div>
                  </div>
                )}
                <div
                  className="flex justify-center @container pl-px"
                  data-chatbox-container="true"
                >
                  <VSCodeChatBox
                    session={selectedSession}
                    workspaceId={workspaceWithSession?.id}
                    isNewSessionMode={isNewSessionMode}
                    sessions={sessions}
                    onSelectSession={selectSession}
                    onStartNewSession={startNewSession}
                    onScrollToPreviousMessage={handleScrollToPreviousMessage}
                    onScrollToBottom={handleScrollToBottom}
                    onClearContextAndAcceptPlan={
                      handleClearContextAndAcceptPlan
                    }
                  />
                </div>
              </MessageEditProvider>
            </EntriesProvider>
          </ApprovalFeedbackProvider>
        </main>
      </div>
    </AppWithStyleOverride>
  );
}
