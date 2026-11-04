import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CanvasIcon } from "./CanvasIcon";
import { Icon } from "./icons";

/** Native-drawn glyphs supplied by the host; the mock/tests use Icon fallbacks. */
export interface SidebarIcons {
  newSession?: ReactNode;
  canvas?: ReactNode;
  plugins?: ReactNode;
  schedules?: ReactNode;
  more?: ReactNode;
  search?: ReactNode;
  view?: ReactNode;
  addWorkspace?: ReactNode;
  folder?: ReactNode;
  folderOpen?: ReactNode;
  plus?: ReactNode;
  close?: ReactNode;
}

export interface SidebarSession {
  id: string;
  title: string;
}

export interface SidebarWorkspace {
  id: string;
  title: string;
  sessionIds: string[];
}

interface CanvasSidebarProps {
  icons?: SidebarIcons;
  sessions: SidebarSession[];
  workspaces: SidebarWorkspace[];
  currentSessionId?: string;
  newSessionPending: boolean;
  navError: string;
  iuiEnabled: boolean;
  zoom: number;
  legacyReplies?: unknown[];
  onNewSession: () => void;
  onNewSessionInWorkspace?: (workspaceId: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  onCreateWorkspace?: () => void;
  onClose: () => void;
  onPlugins?: () => void;
  onSchedules?: () => void;
  onLegacy?: () => void;
  onToggleIui: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onResetView: () => void;
  onArrangeReplies?: () => void;
  onExportLegacy?: () => void;
}

/** Canvas navigation, laid out with the same shell geometry as the DSH sidebar. */
export function CanvasSidebar({
  icons,
  sessions,
  workspaces,
  currentSessionId,
  newSessionPending,
  navError,
  iuiEnabled,
  zoom,
  legacyReplies,
  onNewSession,
  onNewSessionInWorkspace,
  onSwitchSession,
  onOpenWorkspace,
  onCreateWorkspace,
  onClose,
  onPlugins,
  onSchedules,
  onLegacy,
  onToggleIui,
  onZoomOut,
  onZoomIn,
  onResetView,
  onArrangeReplies,
  onExportLegacy,
}: CanvasSidebarProps) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [flat, setFlat] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const query = search.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const groupedIds = useMemo(
    () => new Set(workspaces.flatMap((workspace) => workspace.sessionIds)),
    [workspaces],
  );
  const groups = useMemo(
    () =>
      workspaces
        .map((workspace) => {
          const all = workspace.sessionIds
            .map((id) => sessionById.get(id))
            .filter((session): session is SidebarSession => Boolean(session));
          const workspaceMatches = matches(workspace.title);
          const visible =
            !query || workspaceMatches
              ? all
              : all.filter((session) => matches(session.title));
          return { workspace, all, visible, workspaceMatches };
        })
        .filter(
          (group) =>
            !query || group.visible.length > 0 || group.workspaceMatches,
        ),
    [workspaces, sessionById, query],
  );
  const ungrouped = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !groupedIds.has(session.id) && (!query || matches(session.title)),
      ),
    [sessions, groupedIds, query],
  );
  const flatSessions = useMemo(
    () =>
      sessions.filter((session) => {
        if (!query) return true;
        if (matches(session.title)) return true;
        const workspace = workspaces.find((item) =>
          item.sessionIds.includes(session.id),
        );
        return workspace ? matches(workspace.title) : false;
      }),
    [sessions, workspaces, query],
  );
  const currentWorkspaceId = workspaces.find((workspace) =>
    workspace.sessionIds.includes(currentSessionId ?? ""),
  )?.id;

  const sessionRow = (session: SidebarSession, showWorkspace = false) => {
    const workspace = showWorkspace
      ? workspaces.find((item) => item.sessionIds.includes(session.id))
      : undefined;
    return (
      <button
        type="button"
        className="chat-session-row chat-sidebar-session"
        key={session.id}
        aria-current={currentSessionId === session.id ? "page" : undefined}
        title={session.title}
        onClick={() => onSwitchSession(session.id)}
      >
        <span className="chat-sidebar-session-title">{session.title}</span>
        {workspace && (
          <span className="chat-sidebar-session-meta">{workspace.title}</span>
        )}
      </button>
    );
  };

  return (
    <div
      className="chat-menu chat-sidebar"
      role="dialog"
      aria-label="导航与工作区"
    >
      <button
        type="button"
        className="chat-sidebar-new"
        aria-label="新建会话"
        disabled={newSessionPending}
        onClick={onNewSession}
      >
        <span className="chat-sidebar-new-icon">
          {icons?.newSession ?? <Icon name="plus" size={14} />}
        </span>
        <span>新会话</span>
      </button>

      <nav className="chat-sidebar-nav" aria-label="导航">
        <button
          type="button"
          className="chat-sidebar-nav-row is-active"
          aria-current="page"
          onClick={onClose}
        >
          <span className="chat-sidebar-nav-icon">
            {icons?.canvas ?? <CanvasIcon size={16} />}
          </span>
          <span className="chat-sidebar-nav-label">Canvas · 画布</span>
        </button>
        {onPlugins && (
          <button
            type="button"
            className="chat-sidebar-nav-row"
            onClick={onPlugins}
          >
            <span className="chat-sidebar-nav-icon">
              {icons?.plugins ?? <Icon name="sparkle" size={16} />}
            </span>
            <span className="chat-sidebar-nav-label">插件</span>
          </button>
        )}
        {onSchedules && (
          <button
            type="button"
            className="chat-sidebar-nav-row"
            onClick={onSchedules}
          >
            <span className="chat-sidebar-nav-icon">
              {icons?.schedules ?? <Icon name="clock" size={16} />}
            </span>
            <span className="chat-sidebar-nav-label">自动化任务</span>
          </button>
        )}
        <button
          type="button"
          className="chat-sidebar-nav-row"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((value) => !value)}
        >
          <span className="chat-sidebar-nav-icon">
            {icons?.more ?? <Icon name="apps-add" size={16} />}
          </span>
          <span className="chat-sidebar-nav-label">更多</span>
        </button>
      </nav>

      {moreOpen && (
        <div
          className="chat-sidebar-more"
          role="group"
          aria-label="更多画布操作"
        >
          <div className="chat-sidebar-more-title">视图</div>
          <button type="button" aria-pressed={iuiEnabled} onClick={onToggleIui}>
            <Icon name="artifact" size={15} />
            <span>画布 IUI 渲染</span>
            <span className="chat-sidebar-switch">
              {iuiEnabled ? "开启" : "关闭"}
            </span>
          </button>
          <div className="chat-zoom">
            <button type="button" aria-label="缩小" onClick={onZoomOut}>
              <Icon name="minus" size={15} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="放大" onClick={onZoomIn}>
              <Icon name="plus" size={15} />
            </button>
          </div>
          <button
            type="button"
            disabled={!onArrangeReplies}
            onClick={onArrangeReplies}
            title="按可用宽度整理全部自动回复；保留手动位置，超出时向下延伸"
          >
            <Icon name="fit" size={15} />
            按视口自动排布
          </button>
          <button type="button" onClick={onResetView}>
            <Icon name="fit" size={15} />
            重置视图
          </button>
          {onLegacy && (
            <>
              <div className="chat-sidebar-more-title">旧画布</div>
              <button type="button" onClick={onLegacy}>
                打开节点画布
              </button>
            </>
          )}
          {legacyReplies?.length ? (
            <button type="button" onClick={onExportLegacy}>
              导出升级前原文（{legacyReplies.length} 条）
            </button>
          ) : null}
        </div>
      )}

      <div className="chat-sidebar-region">
        <div className="chat-sidebar-section">
          {searchOpen ? (
            <div className="chat-sidebar-search">
              <span className="chat-sidebar-search-icon" aria-hidden="true">
                {icons?.search ?? <Icon name="search" size={16} />}
              </span>
              <input
                ref={searchInput}
                aria-label="搜索会话"
                placeholder="搜索会话"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  setSearch("");
                  setSearchOpen(false);
                }}
              />
              <button
                type="button"
                aria-label="关闭搜索"
                onClick={() => {
                  setSearch("");
                  setSearchOpen(false);
                }}
              >
                {icons?.close ?? <Icon name="close" size={14} />}
              </button>
            </div>
          ) : (
            <>
              <span className="chat-sidebar-section-label">工作区</span>
              <div className="chat-sidebar-head-actions">
                <button
                  type="button"
                  aria-label="搜索会话"
                  title="搜索会话"
                  onClick={() => setSearchOpen(true)}
                >
                  {icons?.search ?? <Icon name="search" size={16} />}
                </button>
                <button
                  type="button"
                  aria-label="视图选项"
                  title="视图选项"
                  aria-expanded={viewOpen}
                  onClick={() => setViewOpen((value) => !value)}
                >
                  {icons?.view ?? <Icon name="sliders" size={16} />}
                </button>
                {onCreateWorkspace && (
                  <button
                    type="button"
                    aria-label="添加工作区"
                    title="添加工作区"
                    onClick={onCreateWorkspace}
                  >
                    {icons?.addWorkspace ?? <Icon name="folder" size={16} />}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {viewOpen && (
          <div
            className="chat-sidebar-view-menu"
            role="menu"
            aria-label="视图选项"
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!flat}
              onClick={() => {
                setFlat(false);
                setViewOpen(false);
              }}
            >
              按工作区分组
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={flat}
              onClick={() => {
                setFlat(true);
                setViewOpen(false);
              }}
            >
              平铺所有会话
            </button>
          </div>
        )}

        <div
          className="chat-sidebar-list"
          role="tree"
          aria-label="工作区与会话"
        >
          {flat ? (
            <>
              {flatSessions.map((session) => sessionRow(session, true))}
              {flatSessions.length === 0 && (
                <p className="chat-sidebar-empty">没有匹配的会话</p>
              )}
            </>
          ) : (
            <>
              {groups.map(({ workspace, visible }) => (
                <div
                  key={workspace.id}
                  className="chat-workspace-group"
                  role="group"
                  aria-label={workspace.title}
                >
                  <button
                    type="button"
                    className="chat-sidebar-project"
                    onClick={() => onOpenWorkspace?.(workspace.id)}
                  >
                    <span
                      className="chat-sidebar-project-icon"
                      data-current={
                        workspace.id === currentWorkspaceId ? "true" : undefined
                      }
                    >
                      {workspace.id === currentWorkspaceId
                        ? (icons?.folderOpen ?? (
                            <Icon name="folder-open" size={16} />
                          ))
                        : (icons?.folder ?? <Icon name="folder" size={16} />)}
                    </span>
                    <span className="chat-sidebar-project-title">
                      {workspace.title}
                    </span>
                  </button>
                  {onNewSessionInWorkspace && !query && (
                    <button
                      type="button"
                      className="chat-session-row chat-sidebar-session chat-sidebar-session-create"
                      disabled={newSessionPending}
                      onClick={() => onNewSessionInWorkspace(workspace.id)}
                    >
                      <span className="chat-sidebar-session-plus">
                        {icons?.plus ?? <Icon name="plus" size={14} />}
                      </span>
                      <span>在此工作区新建画布会话</span>
                    </button>
                  )}
                  {visible.map((session) => sessionRow(session))}
                </div>
              ))}
              {ungrouped.length > 0 && (
                <div
                  className="chat-workspace-group chat-sidebar-ungrouped"
                  role="group"
                  aria-label="未分组"
                >
                  <div className="chat-sidebar-project chat-sidebar-project-label">
                    <span className="chat-sidebar-project-icon">
                      {icons?.folder ?? <Icon name="folder" size={16} />}
                    </span>
                    <span className="chat-sidebar-project-title">未分组</span>
                  </div>
                  {ungrouped.map((session) => sessionRow(session))}
                </div>
              )}
              {groups.length === 0 && ungrouped.length === 0 && (
                <p className="chat-sidebar-empty">没有匹配的会话</p>
              )}
            </>
          )}
        </div>
      </div>

      {navError && (
        <p className="chat-nav-error" role="alert">
          {navError}
        </p>
      )}
    </div>
  );
}
