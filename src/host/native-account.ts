/**
 * Honest routes to the host-owned account UI.
 *
 * DSH 0.2.0-rc.2 and 0.2.1-rc.2 do not expose an account/settings opener to
 * feature plugins. The single settings.launcher occupant also owns sign-in,
 * account-expiry, and bonus notices, so replacing it would remove behavior.
 * Keep that native occupant intact and disclose the one extra navigation step.
 */
export interface NativeAccountAction {
  label: string;
  description: string;
  run: () => void;
}

export interface NativeAccountActions {
  settings: NativeAccountAction;
  version: NativeAccountAction;
}

/** A route back to native controls, never a pretend settings/version opener. */
export function createNativeAccountActions(
  returnToNative: () => void,
): NativeAccountActions {
  return {
    settings: {
      label: "返回原生界面打开设置",
      description:
        "返回后，使用原生侧栏底部的设置入口。账户功能仍由原生界面提供。",
      run: returnToNative,
    },
    version: {
      label: "返回原生界面查看版本",
      description:
        "返回后，使用原生侧栏底部的设置入口，在通用页面查看当前版本。",
      run: returnToNative,
    },
  };
}
