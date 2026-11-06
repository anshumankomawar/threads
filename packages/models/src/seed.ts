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

// The sample workspace's people, with "you" (whoever runs the app) among them.
const SAMPLE_PEOPLE: [string, string][] = [
  ["you", "You"],
  ["elena", "Elena Park"],
  ["priya", "Priya Shah"],
  ["jordan", "Jordan Lee"],
  ["maya", "Maya Chen"],
  ["daniel", "Daniel Okafor"],
  ["sam", "Sam Rivera"],
];

const HOUR = 3_600_000;
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
  // [author, body, sent to]
  messages: [string, string, string[]][];
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
];

const SAMPLE_LABELS = {
  "q4-planning": "Q4 Planning",
  customers: "Customers",
  compliance: "Compliance",
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
      ],
      [
        "sam",
        "Tuesday's deploy changed the SAML audience to the new domain. Their Okta app still has the old one.",
        ["you", "maya"],
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
      ["jordan", "Can you post the incident summary on the status page?", ["you"]],
      ["you", "Posted, with the timeline and what we changed.", ["jordan"]],
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
    writes.push(
      create("Thread", t.id, {
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
