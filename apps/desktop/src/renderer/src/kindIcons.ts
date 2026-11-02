import type { IconSvgElement } from "@hugeicons/react";
import { BubbleChatIcon, Message01Icon } from "@hugeicons/core-free-icons";
import type { ThreadKind } from "model";

// Each kind of thread's icon, wherever threads are listed.
export const KIND_ICONS: Record<ThreadKind, IconSvgElement> = {
  issue: Message01Icon,
  conversation: BubbleChatIcon,
};
