import { formatDue, formatRelativeTime } from "../format";
import { bucketsOf, plainThreadLinks, STATUS_LABELS, type Status, type Thread } from "model";
import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { useApp } from "../app/state";
import { status, statusDot, topbar } from "../styles/controls";
import { sx } from "../styles/sx";
import { colors, fontSizes, radii } from "../styles/tokens.stylex";
import { SidePanel } from "./SidePanel";

const plain = { borderStyle: "none", font: "inherit", cursor: "pointer" } as const;
const stroke = colors.strokeFocused;
const line = { position: "absolute", left: 0, content: '""', borderColor: stroke } as const;
const row = { display: "flex", alignItems: "center" } as const;
const solid = "solid";

const s = stylex.create({
  topbar: { paddingLeft: 12, color: colors.textSecondary },
  content: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0, overflowY: "auto" },
  contentEnd: { paddingBottom: 16 },
  section: { display: "flex", flexDirection: "column", padding: "0 12px" },
  sectionGap: { marginTop: { default: null, ":not(:first-child)": 6 } },
  sectionLabel: { ...row, height: 28, color: colors.textSecondary },
  row: { ...row, minHeight: 24, gap: 8, fontSize: fontSizes.body },
  label: { flexShrink: 0, width: 84, color: colors.textTertiary },
  value: { ...row, flexWrap: "wrap", gap: 6, minWidth: 0, color: colors.textPrimary },
  overdue: { color: colors.urgent },
  note: { color: colors.textTertiary, fontSize: fontSizes.small },
  link: { ...plain, padding: 0, backgroundColor: "transparent" },
  linkColor: { color: { default: "inherit", ":hover": colors.textPrimary } },
  underline: { textDecoration: { default: null, ":hover": "underline" } },
  // The branch graph, like `git log --graph`: the last branch's line turns the corner at its dot.
  children: { margin: "0 0 0 3.5px", padding: 0, listStyle: "none" },
  branch: {
    position: "relative",
    paddingLeft: 14,
    "::before": { ...line, top: 0, bottom: 0, borderLeftWidth: 1, borderLeftStyle: solid },
    "::after": { ...line, top: 12, width: 10, borderTopWidth: 1, borderTopStyle: solid },
  },
  lastBranch: {
    "::before": { bottom: "auto", width: 10, height: 12, borderBottomLeftRadius: 6 },
    "::after": { display: "none" },
  },
  lastBranchLine: { "::before": { borderBottomWidth: 1, borderBottomStyle: solid } },
  node: { ...plain, ...row, gap: 7, width: "100%", height: 24, padding: "0 4px 0 0" },
  nodeLook: { color: { default: colors.textSecondary, ":hover": colors.textPrimary } },
  nodeFont: { fontSize: fontSizes.body, backgroundColor: "transparent" },
  current: { color: colors.textPrimary, fontWeight: 500 },
  title: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  list: { display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyle: "none" },
  item: {
    ...plain,
    display: "block",
    textAlign: "left",
    width: "100%",
    marginLeft: -6,
    padding: "4px 6px",
  },
  itemLook: { borderRadius: radii.control, color: colors.textPrimary, boxSizing: "content-box" },
  itemFont: { fontSize: fontSizes.body, lineHeight: "17px" },
  hover: { backgroundColor: { default: "transparent", ":hover": colors.bgQuaternary } },
});

const Dot = (props: { status: Status }): JSX.Element => (
  <span class={sx(status.dot, props.status !== "open" && statusDot[props.status])} />
);

const Row = (props: { label: string; children: JSX.Element }): JSX.Element => (
  <div class={sx(s.row)}>
    <span class={sx(s.label)}>{props.label}</span>
    <span class={sx(s.value)}>{props.children}</span>
  </div>
);

const Section = (props: { title: string; children: JSX.Element }): JSX.Element => (
  <section class={sx(s.section, s.sectionGap)}>
    <div class={sx(s.sectionLabel)}>{props.title}</div>
    {props.children}
  </section>
);

// The open thread at a glance: status, due date, bucket and labels, how it branched, and its activity lines.
export function DetailsPanel(): JSX.Element {
  const app = useApp();
  const nameOf = (id: string): string | undefined =>
    app.data.people().find((person) => person.id === id)?.name;
  const plain = (text: string): string => plainThreadLinks(text, app.links.titleOf, nameOf);
  const reveal = (id: string): void =>
    document.getElementById(`entry-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  return (
    <SidePanel size={{ name: "details-width", initial: 280, min: 240, max: 480, edge: "left" }}>
      <div class={sx(topbar.bar, s.topbar)}>Details</div>
      <Show when={app.nav.activeThread()}>
        {(thread) => {
          const due = () => {
            const at = thread().dueAtMs;
            return at === null ? null : formatDue(at, app.now());
          };
          const labels = () => app.data.labels().filter((l) => thread().labelIds.includes(l.id));
          const history = () => thread().entries.flatMap((e) => (e.kind === "event" ? [e] : []));
          const triage = () => thread().triage[app.me().id] ?? null;
          const bucket = () => bucketsOf(app.me()).find((b) => b.id === triage()?.bucketId);
          return (
            <div class={sx(s.content, s.contentEnd)}>
              <Section title="Overview">
                <Row label="Status">
                  <Dot status={thread().status} />
                  {STATUS_LABELS[thread().status]}
                </Row>
                <Show when={due()}>
                  {(shown) => (
                    <Row label="Due">
                      <span class={sx(shown().overdue && s.overdue)}>{shown().label}</span>
                    </Row>
                  )}
                </Show>
                <Show when={bucket() !== undefined && triage()}>
                  {(sorted) => (
                    <Row label="Bucket">
                      <div>{bucket()?.name}</div>
                      <div class={sx(s.note)}>
                        {sorted().manual
                          ? "Placed by you"
                          : sorted().reason || "Sorted by the model"}
                      </div>
                    </Row>
                  )}
                </Show>
                <Show when={labels().length > 0}>
                  <Row label="Labels">
                    <For each={labels()}>
                      {(label) => (
                        <div>
                          <button
                            class={sx(s.link, s.linkColor, s.underline)}
                            onClick={() => app.nav.openLabel(label.id)}
                          >
                            {label.name}
                          </button>
                        </div>
                      )}
                    </For>
                  </Row>
                </Show>
              </Section>
              <ThreadGraph current={thread()} />
              <Show when={history().length > 0}>
                <Section title="Activity">
                  <ul class={sx(s.list)}>
                    <For each={history()}>
                      {(entry) => (
                        <li>
                          <button
                            class={sx(s.item, s.itemLook, s.itemFont, s.hover)}
                            onClick={() => reveal(entry.id)}
                          >
                            {entry.actor.name} {plain(entry.text)} ·{" "}
                            {formatRelativeTime(entry.createdAtMs, app.now())}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Section>
              </Show>
            </div>
          );
        }}
      </Show>
    </SidePanel>
  );
}

// The thread's family from the thread everything branched from, each branch oldest first; click one to open it.
function ThreadGraph(props: { current: Thread }): JSX.Element {
  const app = useApp();
  const branchesOf = (thread: Thread): Thread[] =>
    app.data
      .threads()
      .filter((other) => other.branchedFromId === thread.id)
      .toSorted((a, b) => (a.entries[0]?.createdAtMs ?? 0) - (b.entries[0]?.createdAtMs ?? 0));
  const root = (): Thread => {
    let root = props.current;
    const seen = new Set([root.id]);
    for (;;) {
      const parent = app.data.threads().find((other) => other.id === root.branchedFromId);
      if (parent === undefined || seen.has(parent.id)) return root;
      seen.add(parent.id);
      root = parent;
    }
  };
  const node = (thread: Thread, depth: number): JSX.Element => {
    const branches = (): Thread[] => (depth < 8 ? branchesOf(thread) : []);
    const last = (i: number) => i === branches().length - 1 && [s.lastBranch, s.lastBranchLine];
    return (
      <>
        <button
          class={sx(s.node, s.nodeLook, s.nodeFont, thread.id === props.current.id && s.current)}
          onClick={() => app.nav.openThread(thread.id)}
        >
          <Dot status={thread.status} />
          <span class={sx(s.title)}>{thread.title}</span>
        </button>
        <Show when={branches().length > 0}>
          <ul class={sx(s.children)}>
            <For each={branches()}>
              {(branch, index) => (
                <li class={sx(s.branch, last(index()))}>{node(branch, depth + 1)}</li>
              )}
            </For>
          </ul>
        </Show>
      </>
    );
  };
  return (
    <Show when={root() !== props.current || branchesOf(props.current).length > 0}>
      <Section title="Branches">
        <div>{node(root(), 0)}</div>
      </Section>
    </Show>
  );
}
