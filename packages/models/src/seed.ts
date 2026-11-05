import type { Write } from "server";

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

// [id, name, level, title, manager]; managers come before their reports, since a reference must exist.
type Person = [string, string, string, ("sde" | "pm")?, string?];

// Anshu, Arjun and KK are real; everyone else is made up, so the org chart has a company to show.
const LOCAL_PEOPLE: Person[] = [
  ["nora", "Nora Alvarez", "l8"],
  ["marcus", "Marcus Bell", "l7", "sde", "nora"],
  ["sofia", "Sofia Marin", "l7", "pm", "nora"],
  ["felix", "Felix Wagner", "l7", undefined, "nora"],
  ["lena", "Lena Novak", "l6", "sde", "marcus"],
  ["devika", "Devika Rao", "l6", undefined, "marcus"],
  ["raj", "Raj Mehta", "l6", "pm", "sofia"],
  ["tomas", "Tomás Ruiz", "l5", "sde", "lena"],
  ["wei", "Wei Liu", "l5", "sde", "lena"],
  ["amara", "Amara Osei", "l5", "pm", "sofia"],
  ["kk", "KK", "l2", undefined, "tomas"],
  ["anshu", "Anshu", "l1", undefined, "kk"],
  ["arjun", "Arjun", "l1", undefined, "kk"],
  ["ivy", "Ivy Zhang", "l3", "sde", "tomas"],
  ["omar", "Omar Haddad", "l2", "sde", "tomas"],
  ["grace", "Grace Kim", "l3", "sde", "wei"],
  ["ben", "Ben Carter", "l2", "sde", "wei"],
  ["hana", "Hana Sato", "l4", undefined, "devika"],
  ["leo", "Leo Moreau", "l3", undefined, "devika"],
  ["ella", "Ella Brooks", "l4", "pm", "raj"],
  ["noah", "Noah Fischer", "l3", "pm", "raj"],
  ["zoe", "Zoe Martin", "l4", undefined, "felix"],
];

// The sample workspace's people, with "you" (whoever runs the app) among them.
const SAMPLE_PEOPLE: Person[] = [
  ["elena", "Elena Park", "l7"],
  ["priya", "Priya Shah", "l6", "pm", "elena"],
  ["jordan", "Jordan Lee", "l6", "sde", "elena"],
  ["maya", "Maya Chen", "l5", "pm", "priya"],
  ["daniel", "Daniel Okafor", "l4", "pm", "maya"],
  ["sam", "Sam Rivera", "l4", "sde", "jordan"],
  ["you", "You", "l5", undefined, "priya"],
];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Sample = {
  id: string;
  title: string;
  owner: string;
  labels?: string[];
  priority?: string;
  state?: string;
  dueIn?: number;
  blocks?: string;
  // [author, body, sent to]
  messages: [string, string, string[]][];
};

const SAMPLE_LABELS = {
  "q4-planning": "Q4 Planning",
  customers: "Customers",
  compliance: "Compliance",
};

// The sample's work: asks waiting on you, things you asked of others, a blocked one and a resolved one.
const SAMPLE_THREADS: Sample[] = [
  {
    id: "headcount-plan",
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

const memberId = (userId: string): string => `member-${userId}`;

// A new workspace's rows, in an order where every reference exists: the workspace, its people and their memberships
// (everyone an admin), and in the sample workspace its labels and threads. People's buckets, their `workspaceIds` and
// inbox items are the rules' effects.
export function seed(workspace: string, nowMs = Date.now()): Write[] {
  const sample = workspace === "sample";
  const people = sample ? SAMPLE_PEOPLE : LOCAL_PEOPLE;
  const writes = [
    create("Workspace", workspace, { name: sample ? "Sample" : "Local" }),
    ...people.map(([id, name]) => create("User", id, { name, workspaceIds: [] })),
    ...people.map(([id, , level, title, manager]) =>
      create("WorkspaceMember", memberId(id), {
        workspaceId: workspace,
        userId: id,
        role: "admin",
        level,
        title: title ?? null,
        managerId: manager === undefined ? null : memberId(manager),
      }),
    ),
  ];
  if (!sample) return writes;
  for (const [id, name] of Object.entries(SAMPLE_LABELS))
    writes.push(create("Label", id, { name, workspaceId: workspace }));
  for (const t of SAMPLE_THREADS)
    writes.push(
      create("Thread", t.id, {
        title: t.title,
        state: t.state ?? "open",
        priority: t.priority ?? "none",
        ownerId: t.owner,
        workspaceId: workspace,
        labelIds: t.labels ?? [],
        dueAt: t.dueIn === undefined ? null : nowMs + t.dueIn,
        blocksId: t.blocks ?? null,
      }),
      ...t.messages.map(([authorId, body, toIds], index) =>
        create("Message", `${t.id}-${index}`, {
          threadId: t.id,
          authorId,
          body,
          toIds,
          workspaceId: workspace,
        }),
      ),
    );
  return writes;
}
