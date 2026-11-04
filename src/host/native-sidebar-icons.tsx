import {
  IconAlarmClockOutlineRegular,
  IconAppsAddOutlineRegular,
  IconCloseOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconNewChatOutlineMedium,
  IconPlusOutlineRegular,
  IconProjectAddOutlineRegular,
  IconSearchOutlineRegular,
  IconSlidersTwoOutlineRegular,
  IconSparkleRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { CanvasIcon } from "../ui/CanvasIcon";
import type { SidebarIcons } from "../ui/CanvasSidebar";

/** Host artwork for the canvas navigation, matching the DSH sidebar glyph set. */
export function createNativeSidebarIcons(): SidebarIcons {
  return {
    newSession: <IconNewChatOutlineMedium size={14} />,
    canvas: <CanvasIcon size={16} />,
    plugins: <IconSparkleRegular size={16} />,
    schedules: <IconAlarmClockOutlineRegular size={16} />,
    more: <IconAppsAddOutlineRegular size={16} />,
    search: <IconSearchOutlineRegular size={16} />,
    view: <IconSlidersTwoOutlineRegular size={16} />,
    addWorkspace: <IconProjectAddOutlineRegular size={16} />,
    folder: <IconFolderCloseRegular size={16} />,
    folderOpen: <IconFolderOpenRegular size={16} />,
    plus: <IconPlusOutlineRegular size={14} />,
    close: <IconCloseOutlineRegular size={14} />,
  };
}
