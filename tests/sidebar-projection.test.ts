import test from "node:test";
import assert from "node:assert/strict";
import { projectSidebar } from "../src/host/sidebar-projection";

test("sidebar follows native blank, subagent, archive, title and pin rules without editing history", () => {
  const row = (id: string, extra = {}) => ({
    id,
    blank: false,
    updatedAt: 10,
    ...extra,
  });
  const list = {
    ids: [
      "blank",
      "current",
      "unnamed",
      "named",
      "archived",
      "child",
      "loose",
      "pin",
    ],
    byId: {
      blank: row("blank", { blank: true }),
      current: row("current", { blank: true }),
      unnamed: row("unnamed", { cwd: "/aima", displayTitle: "aima" }),
      named: row("named", { title: "  正式标题  ", updatedAt: 30 }),
      archived: row("archived"),
      child: row("child", { origin: "subagent" }),
      loose: row("loose"),
      pin: row("pin", { title: "置顶", updatedAt: 1 }),
    },
  };
  const ws = {
    items: [
      {
        workspaceId: "w",
        title: "default-workspace",
        sessionIds: list.ids.filter((id) => id !== "loose"),
      },
    ],
    archivedSessionIds: ["archived"],
    pinnedSessionIds: ["pin"],
  };
  const original = JSON.stringify({ list, ws });
  const projected = projectSidebar(list, ws, "current");
  assert.deepEqual(
    projected.sessions.map((s) => s.id),
    ["current", "pin", "named", "loose", "unnamed"],
  );
  assert.deepEqual(
    projected.sessions.map((s) => s.title),
    ["新会话", "置顶", "正式标题", "未命名", "未命名"],
  );
  assert.equal(projected.workspaces[0].title, "默认工作区");
  assert.deepEqual(projected.workspaces[0].sessionIds, [
    "current",
    "pin",
    "named",
    "unnamed",
  ]);
  assert.equal(JSON.stringify({ list, ws }), original);
  assert.ok(!projectSidebar(list, ws, "named").sessions.some((s) => s.blank));
  assert.deepEqual(
    projectSidebar(JSON.parse(JSON.stringify(list)), ws, "current"),
    projected,
    "refresh retains projection",
  );
});
