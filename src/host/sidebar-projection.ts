/** Read-only projection of the public controllers, following the native browser's
 * ordinary-session, blank, archive, pin and title rules. Never mutates history. */
export function projectSidebar(
  list: {
    ids: readonly string[];
    byId: Record<
      string,
      {
        id: string;
        title?: string;
        cwd?: string;
        blank: boolean;
        origin?: string;
        updatedAt: number;
        retainedBy?: { mainView?: number };
      }
    >;
  },
  workspaces: {
    items: readonly {
      workspaceId: string;
      title: string;
      sessionIds: readonly string[];
    }[];
    archivedSessionIds: readonly string[];
    pinnedSessionIds: readonly string[];
  },
  selected?: string,
) {
  const current =
    selected ??
    Object.values(list.byId).find((s) => (s.retainedBy?.mainView ?? 0) > 0)?.id;
  const archived = new Set(workspaces.archivedSessionIds);
  const pinned = new Set(workspaces.pinnedSessionIds);
  const members = new Set(list.ids);
  const sessions = list.ids
    .flatMap((id) => {
      const s = list.byId[id];
      if (
        !s ||
        s.origin === "subagent" ||
        archived.has(id) ||
        (s.blank && id !== current)
      )
        return [];
      return [
        {
          id,
          title: s.blank ? "新会话" : s.title?.trim() || "未命名",
          cwd: s.cwd,
          blank: s.blank,
          pinned: pinned.has(id),
          updatedAt: s.updatedAt,
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(b.blank) - Number(a.blank) ||
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt - a.updatedAt ||
        a.id.localeCompare(b.id),
    );
  const rank = new Map(sessions.map((s, i) => [s.id, i]));
  const accounted = new Set<string>();
  const groups = workspaces.items.map((w) => ({
    id: w.workspaceId,
    title: w.title === "default-workspace" ? "默认工作区" : w.title,
    sessionIds: w.sessionIds
      .filter((id) => {
        if (accounted.has(id) || !members.has(id)) return false;
        accounted.add(id);
        return rank.has(id);
      })
      .sort((a, b) => rank.get(a)! - rank.get(b)!),
  }));
  return { sessions, workspaces: groups };
}
