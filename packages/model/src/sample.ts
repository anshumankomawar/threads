import {
  DUMMY_ZOOM_LINK,
  type Entry,
  type Person,
  type Priority,
  type Relationship,
  type Schedule,
  type Status,
  type Thread,
  type ThreadKind,
} from "./model";

// Fictional teammates for demo threads until real data exists.
const priya: Person = { id: "priya", name: "Priya Shah", level: "l6", role: "pm" };
const maya: Person = { id: "maya", name: "Maya Chen", level: "l5", role: "pm", managerId: "priya" };
const daniel: Person = {
  id: "daniel",
  name: "Daniel Okafor",
  level: "l4",
  role: "pm",
  managerId: "maya",
};
const jordan: Person = { id: "jordan", name: "Jordan Lee", level: "l6", role: "sde" };
const sam: Person = {
  id: "sam",
  name: "Sam Rivera",
  level: "l4",
  role: "sde",
  managerId: "jordan",
};

// Your place in the sample org: Priya manages you, Jordan leads another team, the rest are teammates.
export function relationshipTo(person: Person): Relationship {
  if (person.id === priya.id) return "manager";
  if (person.id === jordan.id) return "lead";
  return "teammate";
}

// Threads with activity you haven't seen yet when the app opens.
export const UNREAD_THREAD_IDS = ["headcount-plan", "headcount-review"];

// The people the local workspace starts with, for trying the app as each of them. No threads yet.
export function localPeople(): Person[] {
  return [
    { id: "anshu", name: "Anshu", level: "l1", managerId: "kk" },
    { id: "arjun", name: "Arjun", level: "l1", managerId: "kk" },
    { id: "kk", name: "KK", level: "l2" },
  ];
}

// Everyone on the sample team, with you first.
export function samplePeople(me: Person): Person[] {
  return [{ ...me, managerId: priya.id }, priya, daniel, jordan, sam, maya];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Draft =
  | ["message", Person, string, number, { decision?: boolean }?]
  | ["event", Person, string, number]
  | ["resolution", Person, string, number]
  | ["call", string, number]
  | ["notes", Omit<Extract<Entry, { kind: "notes" }>, "kind" | "id" | "createdAtMs">, number];

// Today at the given time.
function todayAt(nowMs: number, hour: number, minute = 0): number {
  const date = new Date(nowMs);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

// Next occurrence of a weekday (0 = Sunday) at the given hour, at least a day out.
function nextWeekday(nowMs: number, weekday: number, hour: number): number {
  const date = new Date(nowMs + DAY);
  date.setHours(hour, 0, 0, 0);
  while (date.getDay() !== weekday) date.setDate(date.getDate() + 1);
  return date.getTime();
}

type Line = [Person, string, { decision?: boolean }?] | ["event", Person, string];

// A conversation as drafts, oldest first: starts `startAgoMs` ago and spaces entries `stepMs` apart.
function conversation(startAgoMs: number, stepMs: number, lines: Line[]): Draft[] {
  return lines.map((line, index) => {
    const ago = startAgoMs - index * stepMs;
    if (line[0] === "event") return ["event", line[1], line[2], ago];
    const [author, text, options] = line;
    return ["message", author, text, ago, options];
  });
}

function block(startMs: number, minutes: number): Schedule {
  return { startMs, endMs: startMs + minutes * MINUTE };
}

type Fields = {
  kind?: ThreadKind;
  requester: Person;
  assignee?: Person | null;
  status?: Status;
  priority?: Priority;
  dueAtMs?: number | null;
  schedule?: Schedule | null;
  attendees?: Person[];
};

function thread(id: string, title: string, fields: Fields, nowMs: number, drafts: Draft[]): Thread {
  const entries: Entry[] = drafts.map((draft, index) => {
    const entryId = `${id}-${index}`;
    const createdAtMs = nowMs - (draft[0] === "call" || draft[0] === "notes" ? draft[2] : draft[3]);
    if (draft[0] === "message") {
      const [, author, text, , options] = draft;
      return {
        kind: "message",
        id: entryId,
        author,
        text,
        createdAtMs,
        decision: options?.decision ?? false,
      };
    }
    if (draft[0] === "event")
      return { kind: "event", id: entryId, actor: draft[1], text: draft[2], createdAtMs };
    if (draft[0] === "call") return { kind: "call", id: entryId, link: draft[1], createdAtMs };
    if (draft[0] === "notes") return { kind: "notes", id: entryId, ...draft[1], createdAtMs };
    return { kind: "resolution", id: entryId, author: draft[1], text: draft[2], createdAtMs };
  });
  return {
    id,
    kind: fields.kind ?? "response",
    title,
    requester: fields.requester,
    assignee: fields.assignee ?? null,
    status: fields.status ?? "open",
    priority: fields.priority ?? "none",
    dueAtMs: fields.dueAtMs ?? null,
    schedule: fields.schedule ?? null,
    attendees: fields.attendees ?? [],
    updatedAtMs: Math.max(...entries.map((entry) => entry.createdAtMs)),
    entries,
  };
}

// A day's worth of threads: responses to asks, meetings, and focus blocks, carried from start to completion.
// `me` is whoever runs the app, so the sample asks, meetings and focus blocks are addressed to them.
export function sampleThreads(me: Person, nowMs = Date.now()): Thread[] {
  return [
    // Responses: someone's ask, worked through to a resolution.
    thread(
      "headcount-plan",
      "Approve Q4 headcount plan",
      { requester: priya, assignee: me, priority: "high", dueAtMs: todayAt(nowMs, 23) },
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
      "northwind-prep",
      "Prep notes for Monday's Northwind call",
      {
        requester: maya,
        assignee: me,
        priority: "medium",
        dueAtMs: nextWeekday(nowMs, 1, 10),
        schedule: block(todayAt(nowMs, 11), 45),
      },
      nowMs,
      [
        [
          "message",
          maya,
          "Northwind's renewal call is Monday at 10. Can you pull together their usage from the last quarter and the two support escalations they raised?",
          26 * HOUR,
        ],
        [
          "message",
          priya,
          "Add the seat expansion they asked about in September too, they'll bring it up.",
          24 * HOUR,
        ],
      ],
    ),
    thread(
      "rate-limits",
      "Share API rate-limit numbers with support",
      {
        requester: jordan,
        assignee: me,
        status: "in_progress",
        priority: "medium",
        dueAtMs: nowMs + DAY,
        schedule: block(todayAt(nowMs, 14), 30),
      },
      nowMs,
      [
        [
          "message",
          jordan,
          "Support keeps getting asked what our API rate limits are. Can you pull the current per-plan numbers so they can answer customers directly?",
          6 * HOUR,
        ],
        ["event", me, "changed status to In progress", 5 * HOUR],
      ],
    ),
    thread(
      "onboarding-copy",
      "Review onboarding flow copy",
      { requester: daniel, assignee: me, priority: "low", dueAtMs: nowMs + 6 * DAY },
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
      "pricing-copy",
      "Finalize Q4 pricing page copy",
      {
        requester: priya,
        assignee: daniel,
        status: "waiting",
        priority: "high",
        dueAtMs: nextWeekday(nowMs, 4, 17),
      },
      nowMs,
      [
        [
          "message",
          priya,
          "Can we get the Q4 pricing page copy finalized before Thursday's launch review? Legal flagged the annual discount wording last time, so that line needs another pass.",
          3 * HOUR,
        ],
        ["event", daniel, "changed status to In progress", 2 * HOUR + 50 * MINUTE],
        [
          "message",
          daniel,
          "On it. Two questions before I lock it: are we still showing the Team tier at $12, and does the annual discount stay at 20% or move to two months free?",
          2 * HOUR + 20 * MINUTE,
        ],
        [
          "message",
          priya,
          "Team stays at $12. Go with two months free, it tested better and it's easier for legal to approve.",
          2 * HOUR,
          { decision: true },
        ],
        [
          "message",
          daniel,
          "Updated draft is in the pricing doc. Sent the discount line to legal, waiting on their sign-off before I mark this done.",
          25 * MINUTE,
        ],
        ["event", daniel, "changed status to Waiting", 24 * MINUTE],
      ],
    ),
    thread(
      "checkout-test",
      "Fix flaky checkout test before release",
      {
        requester: jordan,
        assignee: sam,
        status: "done",
        priority: "urgent",
        dueAtMs: nowMs + 18 * HOUR,
      },
      nowMs,
      [
        [
          "message",
          jordan,
          "The checkout e2e test failed on 3 of the last 10 runs. It's blocking tomorrow's release, so please take it before the dashboard work.",
          5 * HOUR,
        ],
        ["event", sam, "changed status to In progress", 4 * HOUR + 40 * MINUTE],
        [
          "message",
          sam,
          "Found it. The test clicks Pay before the Stripe iframe finishes loading. Swapping the fixed timeout for a wait on the iframe's ready event.",
          4 * HOUR,
          { decision: true },
        ],
        [
          "resolution",
          sam,
          "Fix merged. The test now waits for the Stripe iframe, and it passed 20 runs in a row.",
          HOUR,
        ],
      ],
    ),

    // Meetings: scheduled threads whose document holds the agenda and notes.
    thread(
      "design-sync",
      "Design sync",
      {
        kind: "meeting",
        requester: daniel,
        schedule: block(todayAt(nowMs, 10), 30),
        attendees: [daniel, maya, me],
      },
      nowMs,
      [
        [
          "message",
          daniel,
          "Agenda: walk through the new onboarding screens, then decide whether the empty states ship this sprint.",
          20 * HOUR,
        ],
        ["call", DUMMY_ZOOM_LINK, 20 * HOUR],
        [
          "notes",
          {
            summary:
              "Daniel walked through the new onboarding screens. The flow tested well, but the empty states still read as placeholders, so the team agreed to ship the screens now and polish empty states next sprint.",
            decisions: [
              "Onboarding screens ship this sprint without the new empty states.",
              "Empty states move to next sprint with Maya owning the copy.",
              "Skip the welcome video until we have usage data.",
            ],
            actionItems: [
              { text: "Finalize onboarding screen copy", owner: daniel },
              { text: "Draft empty-state copy for the three main views", owner: maya },
              { text: "Add an onboarding completion event to analytics", owner: me },
            ],
          },
          // Written up just after the 10:00 call.
          Math.max(MINUTE, nowMs - todayAt(nowMs, 10, 35)),
        ],
      ],
    ),
    thread(
      "headcount-review",
      "Headcount review",
      {
        kind: "meeting",
        requester: priya,
        schedule: block(todayAt(nowMs, 16), 30),
        attendees: [priya, me],
      },
      nowMs,
      [
        [
          "message",
          priya,
          "Let's go over the Q4 plan before I send it to finance. Bring anything you want changed.",
          35 * MINUTE,
        ],
        ["call", DUMMY_ZOOM_LINK, 35 * MINUTE],
        [
          "notes",
          {
            summary:
              "Priya and you went through the Q4 headcount plan line by line. The two engineering roles are approved as drafted; the designer role is approved but moves to a mid-quarter start to fit the budget.",
            decisions: [
              "Approve both engineering hires for an October start.",
              "Designer role starts mid-November instead of October.",
              "Contractor budget stays flat for Q4.",
            ],
            actionItems: [
              { text: "Send the updated plan to finance", owner: priya },
              { text: "Write the job description for the designer role", owner: me },
            ],
          },
          30 * MINUTE,
        ],
      ],
    ),
    thread(
      "northwind-call",
      "Northwind renewal call",
      {
        kind: "meeting",
        requester: maya,
        schedule: block(nextWeekday(nowMs, 1, 10), 45),
        attendees: [maya, priya, me],
      },
      nowMs,
      [
        [
          "message",
          maya,
          "Goal: renew for another year and scope the seat expansion. I'll lead, you cover usage and escalations.",
          23 * HOUR,
        ],
        ["call", DUMMY_ZOOM_LINK, 23 * HOUR],
      ],
    ),

    thread(
      "pricing-launch-review",
      "Pricing launch review",
      {
        kind: "meeting",
        requester: priya,
        schedule: block(todayAt(nowMs, 15) - DAY, 45),
        attendees: [priya, daniel, jordan, me],
      },
      nowMs,
      [
        [
          "message",
          priya,
          "Agenda: final check on the Q4 pricing page, the legal sign-off on the discount line, and the launch-day support plan.",
          2 * DAY,
        ],
        ["call", DUMMY_ZOOM_LINK, 2 * DAY],
        [
          "notes",
          {
            summary:
              "The team agreed the pricing page is ready apart from the discount wording, which legal expects to approve by Wednesday. Support will get an FAQ and a short walkthrough before launch.",
            decisions: [
              "Team tier stays at $12 per seat.",
              "Annual plans get two months free instead of 20% off.",
              "Launch moves only if legal hasn't approved by Wednesday.",
            ],
            actionItems: [
              { text: "Send the final discount wording to legal", owner: daniel },
              { text: "Write the support FAQ for the new pricing", owner: me },
              { text: "Confirm the launch-day on-call rotation", owner: jordan },
            ],
          },
          DAY - 50 * MINUTE,
        ],
        [
          "message",
          daniel,
          "Discount wording is with legal now. I'll post here as soon as they reply.",
          DAY - 2 * HOUR,
        ],
      ],
    ),

    // Longer threads, for scrolling and the minimap.
    thread(
      "usage-billing",
      "Migrate billing to usage-based pricing",
      {
        requester: priya,
        assignee: me,
        status: "waiting",
        priority: "high",
        dueAtMs: nowMs + 3 * DAY,
        schedule: block(todayAt(nowMs, 15), 60),
      },
      nowMs,
      conversation(4 * DAY, 5 * HOUR, [
        [
          priya,
          "We're moving billing to usage-based pricing next quarter. Can you own the migration plan end to end: metering, invoicing, and how we move existing customers over?",
        ],
        ["event", me, "changed status to In progress"],
        [
          me,
          "Starting with the current billing flow. First question: do we keep seat pricing as a floor, or go fully usage-based?",
        ],
        [
          priya,
          "Keep a seat floor for the Team plan. Enterprise can be fully usage-based.",
          { decision: true },
        ],
        [
          daniel,
          "That changes the pricing page a lot. I'll need the final unit and tiers before I can redo the plan comparison table.",
        ],
        [
          me,
          "Sam, what does metering look like today? Do we have per-account API call counts we can trust?",
        ],
        [
          sam,
          "The metering service already emits an api_call event per request with the account id. It's accurate, but it only keeps 30 days.",
        ],
        [
          jordan,
          "Watch the metering pipeline at month end. It falls behind under load, and we can't invoice on numbers that arrive late.",
        ],
        [
          me,
          "Proposal: bill on API calls and storage GB, invoice monthly in arrears, and keep 13 months of usage for disputes.",
        ],
        [
          priya,
          "Storage will confuse customers. API calls only for v1, we can add storage later.",
          { decision: true },
        ],
        [
          sam,
          "Calls-only is about two weeks of work: extend retention, add a nightly rollup, and expose it to the invoicing job.",
        ],
        [
          daniel,
          "Draft copy for the usage tiers is in the pricing doc, with $0.40 per thousand calls.",
        ],
        [
          me,
          "Migration plan: dual-run the old and new billing for one cycle, compare invoices account by account, then cut over.",
        ],
        [
          jordan,
          "Dual-run is the right call. I'll get finance to sign off on the comparison report before cutover.",
        ],
        [priya, "Good. Let's target the March billing cycle for the cutover.", { decision: true }],
        [sam, "Backfill finished. The last 90 days of usage are in the warehouse."],
        [
          me,
          "Draft usage invoices for our top 20 accounts are ready. Most are within 5% of today's bill, three go up more than 20%.",
        ],
        ["event", me, "changed status to Waiting"],
        [
          priya,
          "I'll review the three big increases tomorrow morning and decide whether they get a grace period.",
        ],
      ]),
    ),
    thread(
      "api-latency",
      "Elevated API latency in us-east",
      {
        requester: jordan,
        assignee: me,
        status: "in_progress",
        priority: "urgent",
        dueAtMs: todayAt(nowMs, 23),
      },
      nowMs,
      conversation(3 * HOUR, 12 * MINUTE, [
        [
          jordan,
          "p95 latency in us-east jumped from 180ms to 1.4s about ten minutes ago. Can you take point?",
        ],
        [me, "On it. Opening the dashboards now."],
        ["event", me, "changed status to In progress"],
        [
          sam,
          "Database CPU is fine, but the connection pool is maxed out. Requests are queuing for a connection.",
        ],
        [
          me,
          "That lines up with deploy 4821 going out 15 minutes ago. It added a new query in the search path.",
        ],
        [
          jordan,
          "Support has tickets from two enterprise customers. How long until we know if it's the deploy?",
        ],
        [me, "Rolling back 4821 now. Rollback over fixing forward, we can investigate after."],
        [jordan, "Agreed, roll back first.", { decision: true }],
        [sam, "Rollback is out. Pool usage is dropping and the queue is draining."],
        [me, "p95 is back under 200ms. Watching it for another 20 minutes before calling it."],
        [
          sam,
          "Found it: the new search query filters on account_id and created_at, and there's no index on that pair.",
        ],
        [
          me,
          "Root cause confirmed. We'll add the composite index and re-ship 4821 behind a flag tomorrow.",
          { decision: true },
        ],
        [sam, "Index is added in staging. Query time went from 900ms to 4ms."],
        [jordan, "Nice work. Let's do the post-incident review Monday morning."],
      ]),
    ),

    // Smaller asks further out, so the inbox has a real Later list.
    thread(
      "okr-draft",
      "Review Q1 OKR draft",
      { requester: priya, assignee: me, priority: "medium", dueAtMs: nowMs + 4 * DAY },
      nowMs,
      [
        [
          "message",
          priya,
          "First draft of our Q1 OKRs is in the planning doc. Comments by Wednesday?",
          2 * DAY,
        ],
      ],
    ),
    thread(
      "interview-feedback",
      "Interview feedback: senior backend candidate",
      { requester: jordan, assignee: me, priority: "medium", dueAtMs: nowMs + 2 * DAY },
      nowMs,
      [
        [
          "message",
          jordan,
          "You did the system design round yesterday. Can you write up your feedback before the debrief?",
          20 * HOUR,
        ],
      ],
    ),
    thread(
      "acme-residency",
      "Reply to Acme's data residency question",
      { requester: maya, assignee: me, priority: "medium", dueAtMs: nowMs + 3 * DAY },
      nowMs,
      [
        [
          "message",
          maya,
          "Acme wants to know if we can keep their data in the EU. Can you draft an answer I can send?",
          9 * HOUR,
        ],
      ],
    ),
    thread(
      "dark-mode-contrast",
      "Fix contrast on the dark-mode settings page",
      { requester: daniel, assignee: me, priority: "low", dueAtMs: nowMs + 7 * DAY },
      nowMs,
      [
        [
          "message",
          daniel,
          "The secondary labels on the settings page fail contrast in dark mode. Low priority, but worth fixing this sprint.",
          DAY,
        ],
      ],
    ),
    thread(
      "soc2-vendors",
      "Update vendor list for the SOC 2 audit",
      { requester: sam, assignee: me, priority: "low", dueAtMs: nowMs + 9 * DAY },
      nowMs,
      [
        [
          "message",
          sam,
          "Auditors want the vendor list updated with every service that touches customer data. Can you fill in the product side?",
          2 * DAY,
        ],
      ],
    ),
    thread(
      "offsite-agenda",
      "Plan the team offsite agenda",
      { requester: maya, assignee: me, priority: "low", dueAtMs: nowMs + 12 * DAY },
      nowMs,
      [
        [
          "message",
          maya,
          "Offsite is in two weeks. Could you put together a draft agenda? Half planning, half something fun.",
          3 * DAY,
        ],
      ],
    ),

    // Focus blocks: your own work, owned and scheduled by you.
    thread(
      "search-ranking",
      "Implement thread search ranking",
      { kind: "focus", requester: me, schedule: block(todayAt(nowMs, 12), 90) },
      nowMs,
      [
        [
          "message",
          me,
          "Rank search results by recent activity, then title match. Ship behind a flag.",
          2 * HOUR,
        ],
      ],
    ),
    thread("roadmap-draft", "Draft Q1 roadmap one-pager", { kind: "focus", requester: me }, nowMs, [
      [
        "message",
        me,
        "One page: three themes, what we're not doing, and the open questions for Priya.",
        DAY,
      ],
    ]),
  ];
}
