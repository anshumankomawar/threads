import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { Icon, type IconName } from "./Icon";
import { Identicon } from "./Identicon";

// Arc's sidebar and message list, drawn with the app's own measurements (Mail.tsx and Tabs.tsx on solid-email) and
// the sample workspace's data as the app shows it, for the window on the landing page. Nothing here is interactive.

const center = { display: "flex", alignItems: "center" } as const;
const column = { display: "flex", flexDirection: "column" } as const;
const pane = { minHeight: 0, overflow: "hidden" } as const;

const s = stylex.create({
  sidebar: {
    ...column,
    ...pane,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
    backgroundColor: colors.chrome,
    fontSize: fontSizes.body,
  },
  // The title bar: after the lights (which the window draws), the sidebar toggle and search; New thread at the end.
  bar: { ...center, flexShrink: 0, gap: 2.5, height: 34, paddingLeft: 69 },
  barEnd: { ...center, gap: 2.5, marginLeft: "auto", paddingRight: 8 },
  barButton: {
    ...center,
    justifyContent: "center",
    width: 22,
    height: 22,
    color: colors.textPrimary,
  },
  // The segments: icon tabs, the chosen one opened out to its name.
  groups: { display: "flex", flexShrink: 0, gap: 2, padding: "2px 8px 8px" },
  tab: {
    ...center,
    height: 24,
    minWidth: 26,
    padding: "0 6px",
    borderRadius: radii.control,
    color: colors.iconTertiary,
    fontSize: 12,
  },
  tabOn: { gap: 6, color: colors.textPrimary, backgroundColor: colors.bgTertiary },
  nav: { flex: 1, minHeight: 0, padding: "2px 8px 12px" },
  mailboxes: { ...column, gap: 2, margin: 0, padding: 0, listStyle: "none" },
  mailbox: {
    ...center,
    gap: 6,
    height: 26,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: radii.row,
    color: colors.textPrimary,
  },
  mailboxOn: { backgroundColor: colors.bgTertiary },
  indent: { marginLeft: 14 },
  mailboxIcon: { display: "flex", flexShrink: 0, color: colors.iconTertiary },
  mailboxName: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "clip",
  },
  count: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
  footer: { ...center, flexShrink: 0, gap: 4, margin: "0 8px 8px" },
  profile: {
    ...center,
    flex: 1,
    minWidth: 0,
    gap: 8,
    padding: "6px 8px",
    color: colors.textSecondary,
  },
  gear: { display: "flex", padding: "0 6px", color: colors.iconTertiary },

  list: {
    ...column,
    ...pane,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: colors.strokeTertiary,
    backgroundColor: colors.frosted,
  },
  listBar: { ...center, flexShrink: 0, gap: 6, height: 34, paddingLeft: 16, paddingRight: 8 },
  listHeading: { display: "flex", flex: 1, gap: 6, alignItems: "baseline", minWidth: 0 },
  listTitle: { color: colors.textPrimary, fontSize: fontSizes.name, fontWeight: 500 },
  listSubtitle: { color: colors.textTertiary, fontSize: fontSizes.small },
  listScroll: { ...column, padding: "0 6px 12px" },
  groupHeader: {
    ...center,
    gap: 6,
    height: 26,
    padding: "0 10px",
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontWeight: 500,
  },
  groupCount: { fontWeight: 400 },
  rows: { margin: 0, padding: 0, listStyle: "none" },
  rowItem: { listStyle: "none" },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    padding: "9px 10px 10px 8px",
    borderRadius: radii.row,
    color: colors.textPrimary,
  },
  rowOn: { backgroundColor: colors.bgTertiary },
  divider: {
    display: "block",
    height: 1,
    marginLeft: 28,
    marginRight: 10,
    backgroundColor: colors.strokeTertiary,
  },
  dividerHidden: { backgroundColor: "transparent" },
  unreadSlot: {
    display: "flex",
    flexShrink: 0,
    justifyContent: "center",
    width: 12,
    paddingTop: 5,
  },
  unreadDot: { width: 8, height: 8, borderRadius: "50%", backgroundColor: colors.systemBlue },
  rowBody: { ...column, flex: 1, gap: 1, minWidth: 0 },
  rowTop: { ...center, gap: 8, marginBottom: 3 },
  who: { ...center, flex: 1, gap: 6, minWidth: 0 },
  from: { flex: 1, fontSize: fontSizes.name, fontWeight: 600, lineHeight: "16px" },
  stamp: {
    flexShrink: 0,
    color: colors.textTertiary,
    fontSize: fontSizes.small,
    fontVariantNumeric: "tabular-nums",
  },
  subjectLine: { ...center, gap: 4, minWidth: 0 },
  subject: {
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "clip",
    fontSize: fontSizes.body,
  },
  subjectUnread: { fontWeight: 600 },
  priority: { flexShrink: 0, color: "#ff9f0a", fontSize: fontSizes.body, fontWeight: 700 },
  urgent: { color: colors.urgent },
  preview: {
    maxHeight: 32,
    overflow: "hidden",
    color: colors.textTertiary,
    fontSize: fontSizes.body,
    lineHeight: "16px",
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 3 },
  due: { ...center, gap: 3, color: colors.textTertiary, fontSize: fontSizes.small },
  dueSoon: { color: colors.urgent },
  labelChip: {
    padding: "0 6px",
    borderRadius: radii.pill,
    color: colors.textSecondary,
    fontSize: fontSizes.small,
    lineHeight: "16px",
    backgroundColor: colors.bgTertiary,
  },
});

export type Priority = "high" | "urgent";
type Row = {
  from: string;
  name: string;
  at: string;
  subject: string;
  preview: string;
  priority?: Priority;
  due?: { on: string; soon?: boolean };
  label?: string;
  unread?: boolean;
  on?: boolean;
};

// The bucket shown, and what's in it; the open thread is the launch checklist.
export const BUCKET = "Messages that require action";
const ROWS: Row[] = [
  {
    from: "sam",
    name: "Sam Rivera",
    at: "2:53 PM",
    subject: "Northwind can't sign in with Okta since Tuesday",
    preview:
      "Tuesday's deploy changed the SAML audience to the new domain. Their Okta app still has the old one.",
    priority: "urgent",
    due: { on: "Nov 7", soon: true },
    label: "Customers",
    unread: true,
  },
  {
    from: "priya",
    name: "Priya Shah",
    at: "12:17 PM",
    subject: "Approve Q4 headcount plan",
    preview:
      "Finance needs our Q4 headcount plan approved by end of day. The draft adds two engineers and a designer.",
    priority: "high",
    due: { on: "Nov 7", soon: true },
    label: "Q4 Planning",
    unread: true,
  },
  {
    from: "ava",
    name: "Ava Thompson",
    at: "2:39 PM",
    subject: "Acme renewal: questions on seat pricing",
    preview:
      "Acme wants to go from 80 to 140 seats at renewal but is asking for the volume tier we only list for 200+.",
    priority: "high",
    due: { on: "Nov 8" },
    label: "Customers",
    unread: true,
  },
  {
    from: "daniel",
    name: "Daniel Okafor",
    at: "1:49 PM",
    subject: "Launch checklist for Threads 2.0",
    preview: "Also: support wants a heads-up email the day before. Drafting it now.",
    priority: "high",
    due: { on: "Nov 9" },
    label: "Launch",
    on: true,
  },
  {
    from: "daniel",
    name: "Daniel Okafor",
    at: "Yesterday",
    subject: "Finalize Q4 pricing page copy",
    preview: "On it. I'll send a draft with two options for the discount line so legal can pick.",
    priority: "high",
    due: { on: "Nov 10" },
    unread: true,
  },
  {
    from: "sam",
    name: "Sam Rivera",
    at: "10:17 AM",
    subject: "Review: move search indexing to a queue",
    preview:
      "PR is up: indexing moves off the request path into a queue consumer, with retries and a dead-letter queue.",
    due: { on: "Nov 8" },
    unread: true,
  },
  {
    from: "noah",
    name: "Noah Fischer",
    at: "3:03 PM",
    subject: "Onboarding redesign: first-run flow",
    preview:
      "Good call. I'll mock a preview with their real imported threads and send it over this afternoon.",
    due: { on: "Nov 10" },
    unread: true,
  },
];
const IN_BUCKET = 10;
const UNREAD = 10;

export const icon = (svg: IconName, size = 14): JSX.Element => (
  <Icon icon={svg} size={size} aria-hidden="true" />
);

// The sidebar's button, as the app draws it: Thunderbird's layout icon.
const SIDEBAR_OPEN: IconName = "layout";

function Mailbox(props: {
  icon: IconName;
  name: string;
  count?: number;
  on?: boolean;
  indent?: boolean;
}): JSX.Element {
  return (
    <li class={sx(s.mailbox, props.on && s.mailboxOn, props.indent && s.indent)}>
      <span class={sx(s.mailboxIcon)}>{icon(props.icon)}</span>
      <span class={sx(s.mailboxName)}>{props.name}</span>
      <Show when={props.count}>
        <span class={sx(s.count)}>{props.count}</span>
      </Show>
    </li>
  );
}

export function Sidebar(): JSX.Element {
  return (
    <aside class={sx(s.sidebar)}>
      <div class={sx(s.bar)}>
        <span class={sx(s.barButton)}>{icon(SIDEBAR_OPEN)}</span>
        <span class={sx(s.barButton)}>{icon("search")}</span>
        <span class={sx(s.barEnd)}>
          <span class={sx(s.barButton)}>{icon("pencil")}</span>
        </span>
      </div>
      <div class={sx(s.groups)}>
        <span class={sx(s.tab, s.tabOn)}>
          {icon("inbox")}
          Inbox
        </span>
        <span class={sx(s.tab)}>{icon("spaces-menu")}</span>
        <span class={sx(s.tab)}>{icon("eye")}</span>
      </div>
      <nav class={sx(s.nav)}>
        <ul class={sx(s.mailboxes)}>
          <Mailbox icon={"inbox"} name="Buckets" count={11} on />
          <Mailbox icon={"priority"} name={BUCKET} count={IN_BUCKET} indent />
          <Mailbox icon={"file"} name="Messages to read" count={1} indent />
          <Mailbox icon={"sent"} name="Sent" />
          <Mailbox icon={"draft"} name="Drafts" />
        </ul>
      </nav>
      <div class={sx(s.footer)}>
        <span class={sx(s.profile)}>
          <Identicon seed="you" size={16} />
          Jamie Lin
        </span>
        <span class={sx(s.gear)}>{icon("settings")}</span>
      </div>
    </aside>
  );
}

function Thread(props: { row: Row; last: boolean; beforeOn: boolean }): JSX.Element {
  const row = props.row;
  return (
    <li class={sx(s.rowItem)}>
      <div class={sx(s.row, row.on && s.rowOn)}>
        <span class={sx(s.unreadSlot)}>
          <Show when={row.unread}>
            <span class={sx(s.unreadDot)} />
          </Show>
        </span>
        <span class={sx(s.rowBody)}>
          <span class={sx(s.rowTop)}>
            <span class={sx(s.who)}>
              <Identicon seed={row.from} size={16} />
              <span class={sx(s.from)}>{row.name}</span>
            </span>
            <span class={sx(s.stamp)}>{row.at}</span>
          </span>
          <span class={sx(s.subjectLine)}>
            <Show when={row.priority}>
              <span class={sx(s.priority, row.priority === "urgent" && s.urgent)}>
                {row.priority === "urgent" ? "!!" : "!"}
              </span>
            </Show>
            <span class={sx(s.subject, row.unread && s.subjectUnread)}>{row.subject}</span>
          </span>
          <span class={sx(s.preview)}>{row.preview}</span>
          <Show when={row.due || row.label}>
            <span class={sx(s.chips)}>
              <Show when={row.due}>
                <span class={sx(s.due, row.due?.soon && s.dueSoon)}>
                  {icon("calendar", 10)}
                  {row.due?.on}
                </span>
              </Show>
              <Show when={row.label}>
                <span class={sx(s.labelChip)}>{row.label}</span>
              </Show>
            </span>
          </Show>
        </span>
      </div>
      <span class={sx(s.divider, (row.on || props.beforeOn || props.last) && s.dividerHidden)} />
    </li>
  );
}

export function MessageList(): JSX.Element {
  return (
    <section class={sx(s.list)}>
      <div class={sx(s.listBar)}>
        <span class={sx(s.listHeading)}>
          <span class={sx(s.listTitle)}>Buckets</span>
          <span class={sx(s.listSubtitle)}>{UNREAD} unread</span>
        </span>
        <span class={sx(s.barButton)}>{icon("filter")}</span>
      </div>
      <div class={sx(s.listScroll)}>
        <div class={sx(s.groupHeader)}>
          {icon("priority", 12)}
          {BUCKET} <span class={sx(s.groupCount)}>{IN_BUCKET}</span>
        </div>
        <ul class={sx(s.rows)}>
          <For each={ROWS}>
            {(row, at) => (
              <Thread
                row={row}
                last={at() === ROWS.length - 1}
                beforeOn={ROWS[at() + 1]?.on === true}
              />
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}
