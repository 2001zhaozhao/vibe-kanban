import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Group, Layout, Panel, Separator } from 'react-resizable-panels';
import type { CreateModeInitialState } from '@/shared/types/createMode';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { usePageTitle } from '@/shared/hooks/usePageTitle';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import { useMobileActiveTab } from '@/shared/stores/useUiPreferencesStore';
import { cn } from '@/shared/lib/utils';
import { workspacesApi } from '@/shared/lib/api';
import { BaseCodingAgent, PermissionPolicy } from 'shared/types';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useExecutionProcesses } from '@/shared/hooks/useExecutionProcesses';
import { getLatestConfigFromProcesses } from '@/shared/lib/executor';
import { CreateModeProvider } from '@/features/create-mode/model/CreateModeProvider';
import {
  consumeCreateModeSeedState,
  getCreateModeSeedVersion,
  subscribeCreateModeSeedState,
} from '@/features/create-mode/model/createModeSeedStore';
import { ReviewProvider } from '@/shared/hooks/ReviewProvider';
import { ChangesViewProvider } from '@/shared/hooks/ChangesViewProvider';
import { WorkspacesSidebarContainer } from './WorkspacesSidebarContainer';
import { LogsContentContainer } from './LogsContentContainer';
import {
  WorkspacesMainContainer,
  type WorkspacesMainContainerHandle,
} from './WorkspacesMainContainer';
import { RightSidebar } from './RightSidebar';
import { ChangesPanelContainer } from './ChangesPanelContainer';
import { CreateChatBoxContainer } from '@/shared/components/CreateChatBoxContainer';
import { PreviewBrowserContainer } from './PreviewBrowserContainer';
import { WorkspacesGuideDialog } from '@/shared/dialogs/shared/WorkspacesGuideDialog';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { LinkedIssueProvider } from '@/shared/providers/remote/LinkedIssueContext';

import {
  PERSIST_KEYS,
  usePaneSize,
  useWorkspacePanelState,
  RIGHT_MAIN_PANEL_MODES,
} from '@/shared/stores/useUiPreferencesStore';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

const WORKSPACES_GUIDE_ID = 'workspaces-guide';

export function WorkspacesLayout() {
  const appNavigation = useAppNavigation();
  const {
    workspaceId,
    workspace: selectedWorkspace,
    isLoading,
    isCreateMode,
    selectedSession,
    selectedSessionId,
    sessions,
    selectSession,
    repos,
    isNewSessionMode,
    startNewSession,
  } = useWorkspaceContext();

  const { t } = useTranslation('common');
  usePageTitle(
    isCreateMode ? t('workspaces.newWorkspace') : selectedWorkspace?.name
  );

  const seedVersion = useSyncExternalStore(
    subscribeCreateModeSeedState,
    getCreateModeSeedVersion,
    getCreateModeSeedVersion
  );
  const consumedSeedVersionRef = useRef(0);
  const [createModeSeed, setCreateModeSeed] = useState<{
    version: number;
    state: CreateModeInitialState | null;
  }>({
    version: 0,
    state: null,
  });

  useEffect(() => {
    if (!isCreateMode) {
      consumedSeedVersionRef.current = 0;
      setCreateModeSeed((current) =>
        current.version === 0 && current.state === null
          ? current
          : { version: 0, state: null }
      );
      return;
    }

    if (seedVersion === 0 || seedVersion === consumedSeedVersionRef.current) {
      return;
    }

    consumedSeedVersionRef.current = seedVersion;
    setCreateModeSeed({
      version: seedVersion,
      state: consumeCreateModeSeedState(),
    });
  }, [isCreateMode, seedVersion]);

  const createModeProviderKey =
    createModeSeed.version > 0
      ? `create-mode-seed-${createModeSeed.version}`
      : 'create-mode-seed-default';

  // Linked issue from user context (always available, unlike project context)
  const userCtx = useUserContext();
  const linkedIssueForWorkspace = useMemo(() => {
    if (!workspaceId || !userCtx?.workspaces) return null;
    const remoteWorkspace = userCtx.workspaces.find(
      (w) => w.local_workspace_id === workspaceId
    );
    if (!remoteWorkspace?.issue_id) return null;
    return {
      remoteProjectId: remoteWorkspace.project_id,
      issueId: remoteWorkspace.issue_id,
    };
  }, [userCtx, workspaceId]);

  // Get execution processes for executor config detection
  const { executionProcesses } = useExecutionProcesses(selectedSession?.id);
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
        attachment_ids: null,
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

  const isMobile = useIsMobile();
  const [mobileTab] = useMobileActiveTab();
  const mainContainerRef = useRef<WorkspacesMainContainerHandle>(null);

  const handleScrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      mainContainerRef.current?.scrollToBottom(behavior);
    },
    []
  );

  const handleWorkspaceCreated = useCallback(
    (workspaceId: string) => {
      appNavigation.goToWorkspace(workspaceId);
    },
    [appNavigation]
  );

  // Use workspace-specific panel state (pass undefined when in create mode)
  const {
    isLeftSidebarVisible,
    isLeftMainPanelVisible,
    isRightSidebarVisible,
    rightMainPanelMode,
    setLeftSidebarVisible,
    setLeftMainPanelVisible,
  } = useWorkspacePanelState(isCreateMode ? undefined : workspaceId);

  const {
    config,
    updateAndSaveConfig,
    loading: configLoading,
  } = useUserSystem();
  const hasAutoShownWorkspacesGuide = useRef(false);

  // Auto-show Workspaces Guide on first visit
  useEffect(() => {
    if (hasAutoShownWorkspacesGuide.current) return;
    if (configLoading || !config) return;

    const seenFeatures = config.showcases?.seen_features ?? [];
    if (seenFeatures.includes(WORKSPACES_GUIDE_ID)) return;

    hasAutoShownWorkspacesGuide.current = true;

    void updateAndSaveConfig({
      showcases: { seen_features: [...seenFeatures, WORKSPACES_GUIDE_ID] },
    });
    WorkspacesGuideDialog.show().finally(() => WorkspacesGuideDialog.hide());
  }, [configLoading, config, updateAndSaveConfig]);

  // Ensure left panels visible when right main panel hidden
  useEffect(() => {
    if (rightMainPanelMode === null) {
      setLeftSidebarVisible(true);
      if (!isLeftMainPanelVisible) setLeftMainPanelVisible(true);
    }
  }, [
    isLeftMainPanelVisible,
    rightMainPanelMode,
    setLeftSidebarVisible,
    setLeftMainPanelVisible,
  ]);

  const [rightMainPanelSize, setRightMainPanelSize] = usePaneSize(
    PERSIST_KEYS.rightMainPanel,
    50
  );

  const defaultLayout: Layout =
    typeof rightMainPanelSize === 'number'
      ? {
          'left-main': 100 - rightMainPanelSize,
          'right-main': rightMainPanelSize,
        }
      : { 'left-main': 50, 'right-main': 50 };

  const onLayoutChange = (layout: Layout) => {
    if (isLeftMainPanelVisible && rightMainPanelMode !== null)
      setRightMainPanelSize(layout['right-main']);
  };

  // ── Mobile layout ──────────────────────────────────────────────────
  // Uses `hidden` CSS class (NOT conditional rendering) to preserve
  // WebSocket connections and scroll positions across tab switches.
  if (isMobile) {
    const mobileContent = (
      <ReviewProvider workspaceId={selectedWorkspace?.id}>
        <ChangesViewProvider>
          <div className="flex flex-col h-full min-h-0">
            {/* Workspaces tab */}
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden',
                mobileTab !== 'workspaces' && 'hidden'
              )}
            >
              <WorkspacesSidebarContainer
                onScrollToBottom={handleScrollToBottom}
              />
            </div>

            {/* Chat tab */}
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden',
                mobileTab !== 'chat' && 'hidden'
              )}
            >
              {isCreateMode ? (
                <CreateChatBoxContainer
                  onWorkspaceCreated={handleWorkspaceCreated}
                />
              ) : (
                <WorkspacesMainContainer
                  ref={mainContainerRef}
                  selectedWorkspace={selectedWorkspace ?? null}
                  selectedSession={selectedSession}
                  selectedSessionId={selectedSessionId}
                  sessions={sessions}
                  repos={repos}
                  onSelectSession={selectSession}
                  isLoading={isLoading}
                  isNewSessionMode={isNewSessionMode}
                  onStartNewSession={startNewSession}
                  onClearContextAndAcceptPlan={handleClearContextAndAcceptPlan}
                />
              )}
            </div>

            {/* Changes tab */}
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden',
                mobileTab !== 'changes' && 'hidden'
              )}
            >
              {selectedWorkspace?.id && (
                <ChangesPanelContainer
                  className=""
                  workspaceId={selectedWorkspace.id}
                />
              )}
            </div>

            {/* Logs tab */}
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden',
                mobileTab !== 'logs' && 'hidden'
              )}
            >
              <LogsContentContainer className="" />
            </div>

            {/* Preview tab */}
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden',
                mobileTab !== 'preview' && 'hidden'
              )}
            >
              {selectedWorkspace?.id && (
                <PreviewBrowserContainer
                  workspaceId={selectedWorkspace.id}
                  className=""
                />
              )}
            </div>

            {/* Git tab */}
            <div
              className={cn(
                'flex-1 min-h-0 overflow-hidden',
                mobileTab !== 'git' && 'hidden'
              )}
            >
              {selectedWorkspace && !isCreateMode && (
                <LinkedIssueProvider
                  issueId={linkedIssueForWorkspace?.issueId ?? undefined}
                  projectId={
                    linkedIssueForWorkspace?.remoteProjectId ?? undefined
                  }
                >
                  <RightSidebar
                    rightMainPanelMode={rightMainPanelMode}
                    selectedWorkspace={selectedWorkspace}
                    repos={repos}
                    linkedIssueForWorkspace={linkedIssueForWorkspace}
                  />
                </LinkedIssueProvider>
              )}
            </div>
          </div>
        </ChangesViewProvider>
      </ReviewProvider>
    );

    return (
      <div className="flex flex-1 min-h-0 h-full">
        <div className="flex-1 min-w-0 h-full">
          {isCreateMode ? (
            <CreateModeProvider
              key={createModeProviderKey}
              initialState={createModeSeed.state}
            >
              {mobileContent}
            </CreateModeProvider>
          ) : (
            mobileContent
          )}
        </div>
      </div>
    );
  }

  const mainContent = (
    <ReviewProvider workspaceId={selectedWorkspace?.id}>
      <ChangesViewProvider>
        <div className="flex h-full">
          <Group
            orientation="horizontal"
            className="flex-1 min-w-0 h-full"
            defaultLayout={defaultLayout}
            onLayoutChange={onLayoutChange}
          >
            {isLeftMainPanelVisible && (
              <Panel
                id="left-main"
                minSize="20%"
                className="min-w-0 h-full overflow-hidden"
              >
                {isCreateMode ? (
                  <CreateChatBoxContainer
                    onWorkspaceCreated={handleWorkspaceCreated}
                  />
                ) : (
                  <WorkspacesMainContainer
                    ref={mainContainerRef}
                    selectedWorkspace={selectedWorkspace ?? null}
                    selectedSession={selectedSession}
                    selectedSessionId={selectedSessionId}
                    sessions={sessions}
                    repos={repos}
                    onSelectSession={selectSession}
                    isLoading={isLoading}
                    isNewSessionMode={isNewSessionMode}
                    onStartNewSession={startNewSession}
                    onClearContextAndAcceptPlan={
                      handleClearContextAndAcceptPlan
                    }
                  />
                )}
              </Panel>
            )}

            {isLeftMainPanelVisible && rightMainPanelMode !== null && (
              <Separator
                id="main-separator"
                className="w-1 bg-transparent hover:bg-brand/50 transition-colors cursor-col-resize"
              />
            )}

            {rightMainPanelMode !== null && (
              <Panel
                id="right-main"
                minSize="20%"
                className="min-w-0 h-full overflow-hidden"
              >
                {rightMainPanelMode === RIGHT_MAIN_PANEL_MODES.CHANGES &&
                  selectedWorkspace?.id && (
                    <ChangesPanelContainer
                      className=""
                      workspaceId={selectedWorkspace.id}
                    />
                  )}
                {rightMainPanelMode === RIGHT_MAIN_PANEL_MODES.LOGS && (
                  <LogsContentContainer className="" />
                )}
                {rightMainPanelMode === RIGHT_MAIN_PANEL_MODES.PREVIEW &&
                  selectedWorkspace?.id && (
                    <PreviewBrowserContainer
                      workspaceId={selectedWorkspace.id}
                      className=""
                    />
                  )}
              </Panel>
            )}
          </Group>

          {isRightSidebarVisible && !isCreateMode && (
            <div className="w-[300px] shrink-0 h-full overflow-hidden">
              <LinkedIssueProvider
                issueId={linkedIssueForWorkspace?.issueId ?? undefined}
                projectId={
                  linkedIssueForWorkspace?.remoteProjectId ?? undefined
                }
              >
                <RightSidebar
                  rightMainPanelMode={rightMainPanelMode}
                  selectedWorkspace={selectedWorkspace}
                  repos={repos}
                  linkedIssueForWorkspace={linkedIssueForWorkspace}
                />
              </LinkedIssueProvider>
            </div>
          )}
        </div>
      </ChangesViewProvider>
    </ReviewProvider>
  );

  return (
    <div className="flex flex-1 min-h-0 h-full">
      {isLeftSidebarVisible && (
        <div className="w-[300px] shrink-0 h-full overflow-hidden">
          <WorkspacesSidebarContainer onScrollToBottom={handleScrollToBottom} />
        </div>
      )}

      <div className="flex-1 min-w-0 h-full">
        {isCreateMode ? (
          <CreateModeProvider
            key={createModeProviderKey}
            initialState={createModeSeed.state}
          >
            {mainContent}
          </CreateModeProvider>
        ) : (
          mainContent
        )}
      </div>
    </div>
  );
}
