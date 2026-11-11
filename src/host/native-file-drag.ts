import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-file-drag/client";
import type { FileDragActions } from "@deepseek-ai/dsh-client-ui-primitives";

/** Keep transfer ownership in DSH; older hosts do not expose or use this service. */
export function createNativeFileDrag(ctx: Context): FileDragActions {
  let actions: FileDragActions | undefined;
  ctx.inject(["fileDrag"], (scope) => {
    const current = scope.fileDrag.actions;
    actions = current;
    scope.effect(() => () => {
      if (actions === current) actions = undefined;
    });
  });
  // Stable forwarding callbacks also handle a service that activates after the
  // canvas. Never fetch protected files or invent an application drag token.
  return {
    prepare(source, signal) {
      if (!actions)
        return Promise.reject(new Error("DSH file drag service unavailable"));
      return actions.prepare(source, signal);
    },
    reportFailure() {
      actions?.reportFailure();
    },
  };
}
