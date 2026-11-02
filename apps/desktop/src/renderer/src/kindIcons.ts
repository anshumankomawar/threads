import type { IconSvgElement } from "@hugeicons/react";
import {
  BubbleChatIcon,
  Calendar03Icon,
  Message01Icon,
  Target02Icon,
} from "@hugeicons/core-free-icons";
import type { ThreadKind } from "model";

// Each kind of thread's icon, wherever threads are listed.
export const KIND_ICONS: Record<ThreadKind, IconSvgElement> = {
  response: Message01Icon,
  meeting: Calendar03Icon,
  focus: Target02Icon,
  conversation: BubbleChatIcon,
};
