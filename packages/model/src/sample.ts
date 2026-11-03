import type { Entry, Group, Label, Person, Priority, Status, Thread } from "./model";

// Fictional teammates for demo threads until real data exists.
const priya: Person = {
  id: "priya",
  name: "Priya Shah",
  level: "l6",
  role: "pm",
  managerId: "elena",
};
const maya: Person = { id: "maya", name: "Maya Chen", level: "l5", role: "pm", managerId: "priya" };
const daniel: Person = {
  id: "daniel",
  name: "Daniel Okafor",
  level: "l4",
  role: "pm",
  managerId: "maya",
};
// The head of the sample org; Priya and Jordan report to her.
const elena: Person = { id: "elena", name: "Elena Park", level: "l7" };
const jordan: Person = {
  id: "jordan",
  name: "Jordan Lee",
  level: "l6",
  role: "sde",
  managerId: "elena",
};
const sam: Person = {
  id: "sam",
  name: "Sam Rivera",
  level: "l4",
  role: "sde",
  managerId: "jordan",
};

// Threads with activity you haven't seen yet when the app opens.
export const UNREAD_THREAD_IDS = ["headcount-plan", "northwind-sso"];

// The people the local workspace starts with, for trying the app as each of them. No threads yet. Anshu, Arjun
// and KK are the real team; everyone above and beside them is made up, so the org view has a company to show.
export function localPeople(): Person[] {
  return [
    { id: "anshu", name: "Anshu", level: "l1", managerId: "kk" },
    { id: "arjun", name: "Arjun", level: "l1", managerId: "kk" },
    { id: "kk", name: "KK", level: "l2", managerId: "tomas" },
    { id: "nora", name: "Nora Alvarez", level: "l8" },
    { id: "marcus", name: "Marcus Bell", level: "l7", role: "sde", managerId: "nora" },
    { id: "lena", name: "Lena Novak", level: "l6", role: "sde", managerId: "marcus" },
    { id: "tomas", name: "Tomás Ruiz", level: "l5", role: "sde", managerId: "lena" },
    { id: "ivy", name: "Ivy Zhang", level: "l3", role: "sde", managerId: "tomas" },
    { id: "omar", name: "Omar Haddad", level: "l2", role: "sde", managerId: "tomas" },
    { id: "wei", name: "Wei Liu", level: "l5", role: "sde", managerId: "lena" },
    { id: "grace", name: "Grace Kim", level: "l3", role: "sde", managerId: "wei" },
    { id: "ben", name: "Ben Carter", level: "l2", role: "sde", managerId: "wei" },
    { id: "devika", name: "Devika Rao", level: "l6", managerId: "marcus" },
    { id: "hana", name: "Hana Sato", level: "l4", managerId: "devika" },
    { id: "leo", name: "Leo Moreau", level: "l3", managerId: "devika" },
    { id: "sofia", name: "Sofia Marin", level: "l7", role: "pm", managerId: "nora" },
    { id: "raj", name: "Raj Mehta", level: "l6", role: "pm", managerId: "sofia" },
    { id: "ella", name: "Ella Brooks", level: "l4", role: "pm", managerId: "raj" },
    { id: "noah", name: "Noah Fischer", level: "l3", role: "pm", managerId: "raj" },
    { id: "amara", name: "Amara Osei", level: "l5", role: "pm", managerId: "sofia" },
    { id: "felix", name: "Felix Wagner", level: "l7", managerId: "nora" },
    { id: "zoe", name: "Zoe Martin", level: "l4", managerId: "felix" },
  ];
}

// Everyone on the sample team, with you first.
export function samplePeople(me: Person): Person[] {
  return [{ ...me, managerId: priya.id }, elena, priya, daniel, jordan, sam, maya];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// One entry, `ago` before now: a message, an activity line or the resolution that closed it.
type Draft = ["message" | "event" | "resolution", Person, string, number];

type Fields = {
  owner: Person;
  assignee?: Person | null;
  status?: Status;
  priority?: Priority;
  dueAtMs?: number | null;
  effortHours?: number;
  labelIds?: string[];
  blocksId?: string;
};

function thread(id: string, title: string, fields: Fields, nowMs: number, drafts: Draft[]): Thread {
  const entries: Entry[] = drafts.map(([kind, person, text, ago], index) => {
    // The opening message is the thread's description (`descriptionOf`), a note; replies are sent to the other side.
    const entryId = index === 0 && kind === "message" ? id : `${id}-${index}`;
    const createdAtMs = nowMs - ago;
    const sentTo =
      index === 0
        ? []
        : [fields.owner, fields.assignee ?? null].filter(
            (other): other is Person => other !== null && other.id !== person.id,
          );
    if (kind === "event") return { kind, id: entryId, actor: person, text, createdAtMs };
    if (kind === "resolution") return { kind, id: entryId, author: person, text, createdAtMs };
    return { kind, id: entryId, author: person, text, sentTo, createdAtMs };
  });
  return {
    id,
    title,
    owner: fields.owner,
    assignees: fields.assignee ? [fields.assignee] : [],
    status: fields.status ?? "open",
    priority: fields.priority ?? "none",
    dueAtMs: fields.dueAtMs ?? null,
    effortHours: fields.effortHours ?? null,
    labelIds: fields.labelIds ?? [],
    // The server's model sorts them into buckets once the workspace loads.
    triage: {},
    doneBy: {},
    snoozedUntil: {},
    branchedFromId: fields.blocksId ?? null,
    blocksId: fields.blocksId ?? null,
    seenBy: {},
    updatedAtMs: Math.max(...entries.map((entry) => entry.createdAtMs)),
    entries,
  };
}

// The demo team's work: a mix of customer asks, bugs, code, reviews and planning waiting on `me` (whoever runs the
// app), a few things `me` asked of others, and some already done.
export function sampleThreads(me: Person, nowMs = Date.now()): Thread[] {
  return [
    thread(
      "headcount-plan",
      "Approve Q4 headcount plan",
      {
        owner: priya,
        assignee: me,
        priority: "high",
        dueAtMs: nowMs + 8 * HOUR,
        effortHours: 1,
        labelIds: ["planning", "q4-planning"],
      },
      nowMs,
      [
        [
          "message",
          priya,
          "Finance needs our Q4 headcount plan approved by end of day. The draft adds two engineers and a designer. Can you check it against the roadmap and sign off or flag what's off?",
          40 * MINUTE,
        ],
      ],
    ),
    thread(
      "northwind-sso",
      "Northwind can't sign in with Okta since Tuesday",
      {
        owner: maya,
        assignee: me,
        priority: "urgent",
        dueAtMs: nowMs + 4 * HOUR,
        effortHours: 2,
        labelIds: ["customer-escalation", "security"],
      },
      nowMs,
      [
        [
          "message",
          maya,
          "Northwind's IT admin says every SSO login has failed since Tuesday's deploy with \"invalid audience\". 140 seats are locked out and their renewal is in two weeks. Can you take a look today?",
          2 * HOUR,
        ],
        [
          "message",
          sam,
          "Tuesday's deploy changed the SAML audience to the new domain. Their Okta app still has the old one.",
          90 * MINUTE,
        ],
      ],
    ),
    thread(
      "checkout-500s",
      "Checkout returns 500s for EU cards",
      {
        owner: jordan,
        assignee: me,
        priority: "high",
        dueAtMs: nowMs + DAY,
        effortHours: 4,
        labelIds: ["incident", "revenue"],
      },
      nowMs,
      [
        [
          "message",
          jordan,
          "About 3% of checkouts from EU cards fail with a 500 since last night. Stack traces point at the 3DS callback timing out after the payment provider's SDK upgrade.",
          5 * HOUR,
        ],
      ],
    ),
    thread(
      "rate-limits",
      "Share API rate-limit numbers with support",
      {
        owner: jordan,
        assignee: me,
        priority: "medium",
        dueAtMs: nowMs + 2 * DAY,
        effortHours: 0.5,
      },
      nowMs,
      [
        [
          "message",
          jordan,
          "Support keeps getting asked what our API rate limits are. Can you pull the current per-plan numbers so they can answer customers directly?",
          6 * HOUR,
        ],
      ],
    ),
    thread(
      "acme-export",
      "Acme wants a CSV export of audit logs",
      {
        owner: maya,
        assignee: me,
        priority: "medium",
        dueAtMs: nowMs + 5 * DAY,
        effortHours: 8,
      },
      nowMs,
      [
        [
          "message",
          maya,
          "Acme's security team asked for audit logs as CSV for their SOC 2 review. They need user, action, IP and timestamp for the last 90 days. Is this a quick export or a real feature?",
          DAY,
        ],
      ],
    ),
    thread(
      "search-pr",
      "Review: move search indexing to a queue",
      { owner: sam, assignee: me, priority: "medium", dueAtMs: nowMs + DAY, effortHours: 1 },
      nowMs,
      [
        [
          "message",
          sam,
          "PR is up: indexing moves off the request path into a queue consumer, with retries and a dead-letter queue. Mostly worried about ordering when the same doc is edited twice quickly.",
          3 * HOUR,
        ],
      ],
    ),
    thread(
      "billing-migration",
      "Migrate invoices to the new billing tables",
      {
        owner: jordan,
        assignee: me,
        priority: "medium",
        dueAtMs: nowMs + 9 * DAY,
        effortHours: 16,
        labelIds: ["launch"],
      },
      nowMs,
      [
        [
          "message",
          jordan,
          "The new billing schema is live behind a flag. We need a backfill for the 1.2M existing invoices, dual writes during the cutover, and a way to roll back if totals don't match.",
          2 * DAY,
        ],
      ],
    ),
    thread(
      "flaky-e2e",
      "Login e2e test fails one run in five",
      { owner: sam, assignee: me, priority: "low", effortHours: 2, labelIds: ["bug"] },
      nowMs,
      [
        [
          "message",
          sam,
          "The login end-to-end test has been flaky all week, usually waiting on the redirect after the magic link. It's blocking merges when it hits.",
          DAY + 3 * HOUR,
        ],
      ],
    ),
    thread(
      "dark-mode",
      "Add dark mode to the settings pages",
      { owner: daniel, assignee: me, priority: "low", effortHours: 4 },
      nowMs,
      [
        [
          "message",
          daniel,
          "Settings is the last part of the app without dark mode. The tokens all exist now, so it should mostly be swapping hard-coded colors.",
          3 * DAY,
        ],
      ],
    ),
    thread(
      "onboarding-copy",
      "Review onboarding flow copy",
      {
        owner: daniel,
        assignee: me,
        priority: "low",
        dueAtMs: nowMs + 6 * DAY,
        effortHours: 1,
        labelIds: ["launch"],
      },
      nowMs,
      [
        [
          "message",
          daniel,
          "New onboarding screens are in Figma. Mind giving the copy a read when you have a minute? No rush, it ships next sprint.",
          3 * DAY,
        ],
      ],
    ),
    thread(
      "staging-access",
      "Grant staging database access for the new contractor",
      {
        owner: elena,
        assignee: me,
        priority: "medium",
        dueAtMs: nowMs + DAY,
        effortHours: 0.5,
        labelIds: ["housekeeping"],
      },
      nowMs,
      [
        [
          "message",
          elena,
          "Ravi starts Monday on the data team. Can you approve read-only access to the staging database for him?",
          4 * HOUR,
        ],
      ],
    ),
    thread(
      "offsite-agenda",
      "Draft the offsite agenda",
      {
        owner: priya,
        assignee: me,
        priority: "low",
        dueAtMs: nowMs + 12 * DAY,
        effortHours: 2,
        labelIds: ["planning", "q4-planning"],
      },
      nowMs,
      [
        [
          "message",
          priya,
          "Can you sketch a two-day agenda for the January offsite? Half planning, half hack day, and leave room for the customer panel.",
          2 * DAY,
        ],
      ],
    ),
    // Waiting on someone else for you.
    thread(
      "pricing-copy",
      "Finalize Q4 pricing page copy",
      { owner: me, assignee: daniel, priority: "high", dueAtMs: nowMs + 3 * DAY },
      nowMs,
      [
        [
          "message",
          me,
          "Can we get the Q4 pricing page copy finalized before Thursday's launch review? Legal flagged the annual discount wording last time.",
          3 * HOUR,
        ],
      ],
    ),
    thread(
      "load-test",
      "Load test the new sync endpoint",
      { owner: me, assignee: sam, priority: "medium", dueAtMs: nowMs + 4 * DAY },
      nowMs,
      [
        [
          "message",
          me,
          "Before we turn it on for everyone, can you load test the sync endpoint at 5x today's peak and share p99s?",
          DAY,
        ],
      ],
    ),
    // Blocked on someone, until they answer.
    thread(
      "soc2-evidence",
      "Collect SOC 2 evidence for access reviews",
      {
        owner: elena,
        assignee: me,
        status: "blocked",
        priority: "high",
        dueAtMs: nowMs + 7 * DAY,
        labelIds: ["compliance"],
      },
      nowMs,
      [
        [
          "message",
          elena,
          "The auditors need quarterly access review evidence for every production system by next week.",
          2 * DAY,
        ],
        ["event", me, "is blocked on [[thread:soc2-okta-export]]", DAY],
      ],
    ),
    thread(
      "soc2-okta-export",
      "Export the Okta group membership report",
      { owner: me, assignee: jordan, blocksId: "soc2-evidence", dueAtMs: nowMs + 3 * DAY },
      nowMs,
      [
        [
          "message",
          me,
          "I need last quarter's Okta group membership export for the SOC 2 access review. Only admins can pull it.",
          DAY,
        ],
      ],
    ),
    // Done.
    thread(
      "status-page",
      "Update the status page after the outage",
      { owner: jordan, assignee: me, status: "closed", priority: "high" },
      nowMs,
      [
        ["message", jordan, "Can you post the incident summary on the status page?", 2 * DAY],
        ["resolution", me, "Posted, with the timeline and what we changed.", 2 * DAY - 2 * HOUR],
      ],
    ),
  ];
}

const SAMPLE_GROUP_ID = "group-q4-planning";

// The sample organization's one group, whose label is already on its planning threads.
export function sampleGroup(me: Person, nowMs: number): { group: Group; label: Label } {
  const name = "Q4 Planning";
  return {
    group: {
      id: SAMPLE_GROUP_ID,
      name,
      labelId: "q4-planning",
      memberIds: [me.id, priya.id, maya.id],
      createdById: priya.id,
      archived: false,
      activity: [],
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
    },
    label: {
      id: "q4-planning",
      name,
      groupId: SAMPLE_GROUP_ID,
      createdById: priya.id,
      createdAtMs: nowMs,
    },
  };
}
