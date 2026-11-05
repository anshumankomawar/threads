import * as i from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "./components/Icon";
import type { Bucket } from "models";

// The first topic a bucket matches gives its icon.
const BY_TOPIC: [RegExp, IconSvgElement][] = [
  [/customer|client|account|escalat|support/i, i.CustomerSupportIcon],
  [/incident|bug|outage|error|postmortem|flaky/i, i.Bug01Icon],
  [/review|approv|sign.?off|access request/i, i.CheckmarkCircle02Icon],
  [/launch|release|ship/i, i.Rocket01Icon],
  [/plan|roadmap|estimate|offsite|hiring/i, i.Calendar03Icon],
  [/admin|expense|compliance|paperwork|hr\b|training/i, i.Briefcase01Icon],
  [/read|fyi|update|announce|news/i, i.BookOpen01Icon],
  [/code|coding|build|engineer|pull request|\bpr\b/i, i.CodeIcon],
  [/security|secur/i, i.Shield01Icon],
  [/design|ui\b|ux\b/i, i.PaintBoardIcon],
  [/team|people|1:1|one.on.one/i, i.UserGroupIcon],
  [/marketing|campaign|press/i, i.Megaphone01Icon],
  [/billing|invoice|finance|payment/i, i.Invoice01Icon],
  [/infra|ops|maintenance|tooling/i, i.Wrench01Icon],
  [/idea|research|explore/i, i.Idea01Icon],
  [/chat|discuss|question/i, i.Message01Icon],
  [/action|todo|to do|task|do\b/i, i.Target02Icon],
];

// For buckets about nothing above, or a second bucket on the same topic.
const SPARE = [i.StarIcon, i.Layers01Icon, i.Leaf01Icon, i.Diamond01Icon, i.Bookmark01Icon];
const ALL = [...SPARE, i.Coffee01Icon, ...BY_TOPIC.map(([, icon]) => icon)];

// Each bucket's icon, from what its name (then description) is about, and no two the same.
export function bucketIcons(buckets: Bucket[]): Map<string, IconSvgElement> {
  const used = new Set<IconSvgElement>();
  const match = (text: string): IconSvgElement | undefined =>
    BY_TOPIC.find(([pattern, icon]) => pattern.test(text) && !used.has(icon))?.[1];
  return new Map(
    buckets.map((bucket) => {
      const icon =
        match(bucket.name) ??
        match(`${bucket.name} ${bucket.description}`) ??
        ALL.find((spare) => !used.has(spare)) ??
        SPARE[0];
      used.add(icon);
      return [bucket.id, icon];
    }),
  );
}
