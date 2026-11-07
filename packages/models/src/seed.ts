import type { Write } from "server";
import { mention } from "./text";

// Everyone's buckets when they're first seen. The last one catches whatever fits nowhere else.
export const DEFAULT_BUCKETS = [
  {
    name: "Messages that require action",
    description:
      "Someone needs you to do something: answer a question, make a decision, review or approve, fix, build or deliver.",
  },
  {
    name: "Messages to read",
    description:
      "Nothing to do but read: updates, announcements, answers to your questions, and anything that doesn't clearly need action from you.",
  },
];

// Anshu, Arjun and KK are real; everyone else is made up, so the workspace has people in it.
const LOCAL_PEOPLE: [string, string][] = [
  ["anshu", "Anshu"],
  ["arjun", "Arjun"],
  ["kk", "KK"],
  ["nora", "Nora Alvarez"],
  ["marcus", "Marcus Bell"],
  ["sofia", "Sofia Marin"],
  ["felix", "Felix Wagner"],
  ["lena", "Lena Novak"],
  ["devika", "Devika Rao"],
  ["raj", "Raj Mehta"],
  ["tomas", "Tomás Ruiz"],
  ["wei", "Wei Liu"],
  ["amara", "Amara Osei"],
  ["ivy", "Ivy Zhang"],
  ["omar", "Omar Haddad"],
  ["grace", "Grace Kim"],
  ["ben", "Ben Carter"],
  ["hana", "Hana Sato"],
  ["leo", "Leo Moreau"],
  ["ella", "Ella Brooks"],
  ["noah", "Noah Fischer"],
  ["zoe", "Zoe Martin"],
];

// The sample workspace's people. "you" is whoever runs the app, with a name of their own so the demo reads as a team.
const SAMPLE_PEOPLE: [string, string][] = [
  ["you", "Jamie Lin"],
  ["elena", "Elena Park"],
  ["priya", "Priya Shah"],
  ["jordan", "Jordan Lee"],
  ["maya", "Maya Chen"],
  ["daniel", "Daniel Okafor"],
  ["sam", "Sam Rivera"],
  ["noah", "Noah Fischer"],
  ["ava", "Ava Thompson"],
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Sample = {
  id: string;
  title: string;
  owner: string;
  labels?: string[];
  subspace?: string;
  priority?: string;
  state?: string;
  dueIn?: number;
  blocks?: string;
  // [author, body, sent to, how long ago it was sent]; without a time, the thread's messages are a few minutes apart.
  messages: [string, string, string[], number?][];
};

// An open subspace, and a private one only its members see.
const SAMPLE_SUBSPACES: {
  id: string;
  name: string;
  description: string;
  visibility: string;
  members: string[];
}[] = [
  {
    id: "engineering",
    name: "Engineering",
    description:
      "Where we build and run the product: incidents, customer-reported bugs, code reviews and infrastructure changes. Anyone can bring something here; whoever picks it up owns it until it ships or is resolved.",
    visibility: "open",
    members: ["you", "sam", "maya", "daniel"],
  },
  {
    id: "leadership",
    name: "Leadership",
    description:
      "Decisions that need the leadership team before they go wider: hiring plans, budgets, pricing and anything sensitive about people. Kept private, so only its members see these threads.",
    visibility: "private",
    members: ["you", "priya", "elena"],
  },
  {
    id: "design",
    name: "Design",
    description:
      "Product and brand design: reviews, research and the design system. Bring work in progress early; nothing here has to be finished.",
    visibility: "open",
    members: ["you", "noah", "maya"],
  },
  {
    id: "gtm",
    name: "Go-to-market",
    description:
      "Launches, pricing, sales and the customers we're working with. Anything that changes what a customer sees or pays starts here.",
    visibility: "open",
    members: ["you", "daniel", "ava", "maya"],
  },
];

const SAMPLE_LABELS = {
  "q4-planning": "Q4 Planning",
  customers: "Customers",
  compliance: "Compliance",
  launch: "Launch",
  bug: "Bug",
};

// The sample's work: asks waiting on you, things you asked of others, a blocked one and a resolved one.
const SAMPLE_THREADS: Sample[] = [
  {
    id: "headcount-plan",
    subspace: "leadership",
    title: "Approve Q4 headcount plan",
    owner: "priya",
    labels: ["q4-planning"],
    priority: "high",
    dueIn: 8 * HOUR,
    messages: [
      [
        "priya",
        "Finance needs our Q4 headcount plan approved by end of day. The draft adds two engineers and a designer. Can you check it against the roadmap and sign off or flag what's off?",
        ["you"],
        3 * HOUR,
      ],
    ],
  },
  {
    id: "northwind-sso",
    subspace: "engineering",
    title: "Northwind can't sign in with Okta since Tuesday",
    owner: "maya",
    labels: ["customers"],
    priority: "urgent",
    dueIn: 4 * HOUR,
    messages: [
      [
        "maya",
        "Northwind's IT admin says every SSO login has failed since Tuesday's deploy with \"invalid audience\". 140 seats are locked out and their renewal is in two weeks. Can you take a look today?",
        ["you"],
        52 * MINUTE,
      ],
      [
        "sam",
        "Tuesday's deploy changed the SAML audience to the new domain. Their Okta app still has the old one.",
        ["you", "maya"],
        24 * MINUTE,
      ],
    ],
  },
  {
    id: "search-pr",
    subspace: "engineering",
    title: "Review: move search indexing to a queue",
    owner: "sam",
    priority: "medium",
    dueIn: DAY,
    messages: [
      [
        "sam",
        "PR is up: indexing moves off the request path into a queue consumer, with retries and a dead-letter queue. Mostly worried about ordering when the same doc is edited twice quickly.",
        ["you"],
        5 * HOUR,
      ],
    ],
  },
  {
    id: "pricing-copy",
    title: "Finalize Q4 pricing page copy",
    owner: "you",
    priority: "high",
    dueIn: 3 * DAY,
    messages: [
      [
        "you",
        "Can we get the Q4 pricing page copy finalized before Thursday's launch review? Legal flagged the annual discount wording last time.",
        ["daniel"],
        DAY + 2 * HOUR,
      ],
      [
        "daniel",
        "On it. I'll send a draft with two options for the discount line so legal can pick.",
        ["you"],
        DAY + HOUR,
      ],
    ],
  },
  {
    id: "soc2-evidence",
    title: "Collect SOC 2 evidence for access reviews",
    owner: "elena",
    labels: ["compliance"],
    priority: "high",
    dueIn: 7 * DAY,
    messages: [
      [
        "elena",
        "The auditors need quarterly access review evidence for every production system by next week.",
        ["you"],
        2 * DAY,
      ],
    ],
  },
  {
    id: "soc2-okta-export",
    title: "Export the Okta group membership report",
    owner: "you",
    labels: ["compliance"],
    blocks: "soc2-evidence",
    dueIn: 3 * DAY,
    messages: [
      [
        "you",
        "I need last quarter's Okta group membership export for the SOC 2 access review. Only admins can pull it.",
        ["jordan"],
        2 * DAY - HOUR,
      ],
    ],
  },
  {
    id: "status-page",
    title: "Update the status page after the outage",
    owner: "jordan",
    state: "resolved",
    priority: "high",
    messages: [
      ["jordan", "Can you post the incident summary on the status page?", ["you"], 3 * DAY],
      ["you", "Posted, with the timeline and what we changed.", ["jordan"], 3 * DAY - 2 * HOUR],
    ],
  },
  {
    id: "launch-checklist",
    subspace: "gtm",
    title: "Launch checklist for Threads 2.0",
    owner: "daniel",
    labels: ["launch"],
    priority: "high",
    dueIn: 2 * DAY,
    messages: [
      [
        "daniel",
        "Launch is Thursday. Docs, changelog and the announcement post are ready; what's left is the pricing page and a final pass on the onboarding flow. Can you own the go/no-go on Wednesday?",
        ["you"],
        2 * HOUR + 10 * MINUTE,
      ],
      [
        "you",
        "Yes. Let's do go/no-go at 4pm Wednesday with design and support in the room.",
        ["daniel"],
        HOUR + 45 * MINUTE,
      ],
      [
        "daniel",
        "Booked. I'll bring the launch metrics dashboard so we can agree on what success looks like for week one.",
        ["you"],
        HOUR + 30 * MINUTE,
      ],
      [
        "daniel",
        "Also: support wants a heads-up email the day before. Drafting it now.",
        [],
        HOUR + 28 * MINUTE,
      ],
    ],
  },
  {
    id: "onboarding-redesign",
    subspace: "design",
    title: "Onboarding redesign: first-run flow",
    owner: "noah",
    priority: "medium",
    dueIn: 3 * DAY,
    messages: [
      [
        "noah",
        "New first-run flow is in Figma: three steps instead of seven, and we import your first threads from Slack before asking anything else. Would love your eyes on step two before Thursday.",
        ["you"],
        4 * HOUR,
      ],
      [
        "you",
        "Love the import-first idea. Step two asks for buckets before people have seen their inbox; could we show a sorted preview there instead?",
        ["noah"],
        3 * HOUR + 20 * MINUTE,
      ],
      [
        "noah",
        "Good call. I'll mock a preview with their real imported threads and send it over this afternoon.",
        ["you"],
        14 * MINUTE,
      ],
    ],
  },
  {
    id: "acme-renewal",
    subspace: "gtm",
    title: "Acme renewal: questions on seat pricing",
    owner: "ava",
    labels: ["customers"],
    priority: "high",
    dueIn: DAY,
    messages: [
      [
        "ava",
        "Acme wants to go from 80 to 140 seats at renewal but is asking for the volume tier we only list for 200+. Are we okay offering it for a two-year term?",
        ["you"],
        38 * MINUTE,
      ],
    ],
  },
  {
    id: "staging-deploys",
    subspace: "engineering",
    title: "Staging deploys failing about one in five",
    owner: "sam",
    labels: ["bug"],
    priority: "medium",
    messages: [
      [
        "sam",
        "Roughly one in five staging deploys fails at the migration step with a lock timeout. Looks like the old preview environments are still holding connections.",
        ["you", "jordan"],
        6 * HOUR,
      ],
      [
        "jordan",
        "Confirmed, 40-odd preview databases never got torn down. I'll add a nightly cleanup job.",
        ["sam", "you"],
        5 * HOUR,
      ],
    ],
  },
  {
    id: "weekly-update",
    title: "Weekly product update",
    owner: "priya",
    messages: [
      [
        "priya",
        "This week: Threads 2.0 is on track for Thursday, inbox sorting accuracy is up to 94%, and we closed three of the four Q4 hires. Full notes and metrics are in the doc. Nothing needed from anyone, just keeping you in the loop.",
        ["you"],
        7 * HOUR,
      ],
    ],
  },
  {
    id: "design-hire",
    subspace: "design",
    title: "Senior designer loop: final round on Monday",
    owner: "noah",
    messages: [
      [
        "noah",
        "Our last senior designer candidate is in Monday. Their portfolio review is at 11; can you take the product sense interview at 2?",
        ["you"],
        DAY + 5 * HOUR,
      ],
    ],
  },
];

const create = (model: string, modelId: string, changes: Record<string, unknown>): Write => ({
  kind: "create",
  model,
  modelId,
  changes,
});

// A new workspace's rows, in an order where every reference exists: the workspace, its people and their memberships
// (everyone an admin), and in the sample workspace its subspaces, labels and threads. People's buckets, their `workspaceIds` and
// inbox items are the rules' effects.
export function seed(workspace: string, nowMs = Date.now()): Write[] {
  const sample = workspace === "sample";
  const people = sample ? SAMPLE_PEOPLE : LOCAL_PEOPLE;
  const writes = [
    create("Workspace", workspace, { name: sample ? "Sample" : "Local" }),
    ...people.map(([id, name]) => create("User", id, { name, workspaceIds: [] })),
    ...people.map(([id]) =>
      create("WorkspaceMember", `member-${id}`, {
        workspaceId: workspace,
        userId: id,
        role: "admin",
      }),
    ),
  ];
  if (!sample) return writes;
  for (const { id, name, description, visibility, members } of SAMPLE_SUBSPACES)
    writes.push(
      create("Subspace", id, { name, description, visibility, workspaceId: workspace }),
      ...members.map((userId) =>
        create("SubspaceMember", `${id}-${userId}`, { subspaceId: id, userId }),
      ),
    );
  for (const [id, name] of Object.entries(SAMPLE_LABELS))
    writes.push(create("Label", id, { name, workspaceId: workspace }));
  for (const t of SAMPLE_THREADS) {
    const subspaceIds = t.subspace ? [t.subspace] : [];
    // When each message was sent: its own time, or a few minutes after the one before.
    const sentAt = (index: number): number =>
      nowMs - (t.messages[index][3] ?? (t.messages.length - index) * 4 * MINUTE);
    writes.push(
      create("Thread", t.id, {
        createdAt: sentAt(0),
        title: t.title,
        state: t.state ?? "open",
        priority: t.priority ?? "none",
        ownerId: t.owner,
        workspaceId: workspace,
        labelIds: t.labels ?? [],
        subspaceIds,
        assigneeIds: [],
        dueAt: t.dueIn === undefined ? null : nowMs + t.dueIn,
        blocksId: t.blocks ?? null,
      }),
      ...t.messages.map(([authorId, body, toIds], index) =>
        create("Message", `${t.id}-${index}`, {
          createdAt: sentAt(index),
          threadId: t.id,
          authorId,
          body: [...toIds.map(mention), body].join(" "),
          workspaceId: workspace,
          subspaceIds,
        }),
      ),
    );
  }
  return writes;
}
