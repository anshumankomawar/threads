import {
  BookOpen01Icon,
  Bookmark01Icon,
  Briefcase01Icon,
  Bug01Icon,
  Calendar03Icon,
  CheckmarkCircle02Icon,
  CodeIcon,
  Coffee01Icon,
  CustomerSupportIcon,
  Diamond01Icon,
  Idea01Icon,
  Invoice01Icon,
  Layers01Icon,
  Leaf01Icon,
  Megaphone01Icon,
  Message01Icon,
  PaintBoardIcon,
  Rocket01Icon,
  Shield01Icon,
  StarIcon,
  Target02Icon,
  UserGroupIcon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "./components/Icon";
import type { Bucket } from "model";

// What a bucket's name or description is about, and its icon: the first match wins.
const BY_TOPIC: [RegExp, IconSvgElement][] = [
  [/customer|client|account|escalat|support/i, CustomerSupportIcon],
  [/incident|bug|outage|error|postmortem|flaky/i, Bug01Icon],
  [/review|approv|sign.?off|access request/i, CheckmarkCircle02Icon],
  [/launch|release|ship/i, Rocket01Icon],
  [/plan|roadmap|estimate|offsite|hiring/i, Calendar03Icon],
  [/admin|expense|compliance|paperwork|hr\b|training/i, Briefcase01Icon],
  [/read|fyi|update|announce|news/i, BookOpen01Icon],
  [/code|coding|build|engineer|pull request|\bpr\b/i, CodeIcon],
  [/security|secur/i, Shield01Icon],
  [/design|ui\b|ux\b/i, PaintBoardIcon],
  [/team|people|1:1|one.on.one/i, UserGroupIcon],
  [/marketing|campaign|press/i, Megaphone01Icon],
  [/billing|invoice|finance|payment/i, Invoice01Icon],
  [/infra|ops|maintenance|tooling/i, Wrench01Icon],
  [/idea|research|explore/i, Idea01Icon],
  [/chat|discuss|question/i, Message01Icon],
  [/action|todo|to do|task|do\b/i, Target02Icon],
];

// For buckets about nothing above, or a second bucket on the same topic.
const SPARE: IconSvgElement[] = [
  StarIcon,
  Layers01Icon,
  Leaf01Icon,
  Diamond01Icon,
  Bookmark01Icon,
  Coffee01Icon,
];

// Each of your buckets' icons, from what it's about, and no two the same.
export function bucketIcons(buckets: Bucket[]): Map<string, IconSvgElement> {
  const used = new Set<IconSvgElement>();
  const icons = new Map<string, IconSvgElement>();
  const free = ([, icon]: [RegExp, IconSvgElement]): boolean => !used.has(icon);
  for (const bucket of buckets) {
    const text = `${bucket.name} ${bucket.description}`;
    const icon =
      BY_TOPIC.find((topic) => topic[0].test(bucket.name) && free(topic))?.[1] ??
      BY_TOPIC.find((topic) => topic[0].test(text) && free(topic))?.[1] ??
      [...SPARE, ...BY_TOPIC.map(([, topicIcon]) => topicIcon)].find((spare) => !used.has(spare)) ??
      SPARE[0];
    used.add(icon);
    icons.set(bucket.id, icon);
  }
  return icons;
}
