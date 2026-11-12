// Fills the local API's `local` workspace with realistic threads, for trying ⌘F's search on more than a handful. It
// writes through the sync API as the seeded people (locally a token is a person's id), so the server's rules, inbox
// items and search indexing all run as in the app. Run it with the API up: `vpx apps/api/scripts/seed-threads.ts [count]`.
// Each run adds more; start the workspace over (delete apps/api/.cloudflare/state/v3/do, API stopped) to clear them.
const API = "http://127.0.0.1:3030";
const WORKSPACE = "local";
const COUNT = Number(process.argv[2] ?? 250);

// A seeded random, so every run writes the same threads.
let seed = 7;
const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

const people = [
  "anshu",
  "arjun",
  "kk",
  "nora",
  "marcus",
  "sofia",
  "felix",
  "lena",
  "devika",
  "raj",
  "tomas",
  "wei",
  "amara",
  "ivy",
  "omar",
  "grace",
  "ben",
  "hana",
  "leo",
  "ella",
  "noah",
  "zoe",
];
const customers = [
  "Northwind",
  "Globex",
  "Initech",
  "Umbrella",
  "Hooli",
  "Vandelay",
  "Stark Industries",
  "Wayne Enterprises",
  "Acme",
  "Soylent",
  "Pied Piper",
  "Massive Dynamic",
];
const codenames = [
  "falcon",
  "atlas",
  "nimbus",
  "orion",
  "kraken",
  "phoenix",
  "tundra",
  "cobalt",
  "ember",
  "juniper",
  "quartz",
];
const services = [
  "billing",
  "auth",
  "search",
  "notifications",
  "payments",
  "ingestion",
  "the sync engine",
  "exports",
  "webhooks",
  "the mobile API",
];
const quarters = ["Q1", "Q2", "Q3", "Q4"];
const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const regions = ["us-east-1", "eu-west-1", "ap-southeast-2"];
const tools = [
  "Okta",
  "Salesforce",
  "Datadog",
  "PagerDuty",
  "Stripe",
  "Figma",
  "Linear",
  "Snowflake",
  "Zendesk",
  "GitHub Actions",
];

type Vars = {
  customer: string;
  codename: string;
  service: string;
  quarter: string;
  day: string;
  region: string;
  tool: string;
};
// A thread: its messages are [slot, text], slot 0 being its owner; `@n` mentions whoever is in slot n.
type Scenario = (v: Vars) => { title: string; description: string; messages: [number, string][] };

const scenarios: Scenario[] = [
  // The first thread is always this one: "hydra" is only in a reply, never in the title, as ⌘F's first example.
  (v) => ({
    title: "Integration test plan",
    description: `How we test ${v.service} end to end before the ${v.quarter} release.`,
    messages: [
      [
        0,
        "Draft is in the doc: contract tests per service, then the full suite against staging. @1 can you own the payments flows?",
      ],
      [
        1,
        "Yes. We'll run the suite on hydra before Friday, it's the only cluster with production-sized data.",
      ],
      [
        2,
        "Let's add a smoke run on every merge so we don't wait for the nightly to find breakage.",
      ],
    ],
  }),
  (v) => ({
    title: `${v.customer} can't sign in with ${v.tool} since ${v.day}`,
    description: `Every SSO login from ${v.customer} fails with "invalid audience".`,
    messages: [
      [
        0,
        `@1 ${v.customer}'s IT admin says nobody can sign in since ${v.day}'s deploy. They're on the enterprise plan, so this is urgent.`,
      ],
      [
        1,
        `${v.day}'s deploy changed the SAML audience to the new domain. Their ${v.tool} app still points at the old one.`,
      ],
      [0, "Can we accept both audiences for a week while they update it?"],
      [1, "Shipping that now behind a flag."],
    ],
  }),
  (v) => ({
    title: `Latency spike on ${v.service} in ${v.region}`,
    description: "p99 went from 180 ms to 2.4 s at 14:05 UTC.",
    messages: [
      [
        0,
        `@1 ${v.tool} paged for ${v.service}. Looks like connection pool exhaustion after the ${v.codename} rollout.`,
      ],
      [1, `Rolled ${v.codename} back in ${v.region}; p99 is recovering.`],
      [
        2,
        "We should cap the pool per pod instead of per node. I'll write it up for the postmortem.",
      ],
    ],
  }),
  (v) => ({
    title: `Postmortem: ${v.service} outage on ${v.day}`,
    description: `42 minutes of failed requests in ${v.region}. Timeline, impact and follow-ups.`,
    messages: [
      [0, "First draft is up. Root cause: a migration took a table lock during peak traffic."],
      [1, "Add that the alert fired 9 minutes late because the threshold was tuned for weekends."],
      [2, "Follow-up: run migrations through the online schema tool from now on."],
    ],
  }),
  (v) => ({
    title: `Renewal: ${v.customer} wants a 15% discount`,
    description: `Their contract renews end of ${v.quarter}; procurement is pushing on price.`,
    messages: [
      [
        0,
        `@1 ${v.customer} says a competitor quoted them lower. Usage grew 40% this year, so I'd rather trade discount for a two-year term.`,
      ],
      [1, "Agree. Offer 8% for two years, 15% only with a three-year commit and case study."],
      [0, `Sent. Their CFO meets on ${v.day}.`],
    ],
  }),
  (v) => ({
    title: `Hire a senior engineer for ${v.service}`,
    description: `Backfill for the ${v.quarter} plan; the role is approved.`,
    messages: [
      [
        0,
        "@1 can you review the job description? I want it to say we work on hard distributed systems problems without sounding like a whiteboard quiz.",
      ],
      [1, "Looks good. Cut the list of frameworks; nobody reads past the third bullet."],
      [2, "I have two referrals from my last team, sending them over."],
    ],
  }),
  (v) => ({
    title: `${v.quarter} budget for ${v.tool}`,
    description: "Seats are up 30%; finance wants a plan before the invoice.",
    messages: [
      [
        0,
        `@1 we're paying for 120 ${v.tool} seats and 70 are active. Can we drop to annual billing at 90?`,
      ],
      [1, "Yes, but the price per seat goes up under 100. Run the numbers both ways first."],
    ],
  }),
  (v) => ({
    title: `Design review: ${v.codename} onboarding`,
    description: "New users skip the import step and end up with an empty workspace.",
    messages: [
      [
        0,
        'Figma is linked. The big change: import moves before the invite step, with a "do this later" link.',
      ],
      [
        1,
        "Love it. The empty state still needs a sample workspace option for people with nothing to import.",
      ],
      [2, "Can we test it with five users before building? I'll recruit from support tickets."],
    ],
  }),
  (v) => ({
    title: `Security questionnaire from ${v.customer}`,
    description: `180 questions, due ${v.day}. Most are answered by our SOC 2 report.`,
    messages: [
      [0, "@1 can you take the encryption and key management section?"],
      [
        1,
        `On it. Data at rest is AES-256, keys rotate yearly, customer-managed keys are on the roadmap for ${v.quarter}.`,
      ],
      [2, 'Don\'t promise the roadmap item in writing; say "evaluating".'],
    ],
  }),
  (v) => ({
    title: `Migrate ${v.service} off the old queue`,
    description: `Project ${v.codename}: move to the managed queue and delete the cron workers.`,
    messages: [
      [0, "Plan: dual-write for a week, compare counts, then cut reads over."],
      [
        1,
        "The retry semantics differ: the old queue retried forever, the new one gives up after 10. We need a dead-letter alert.",
      ],
      [0, `Good catch. @2 can you set up the alert in ${v.tool}?`],
    ],
  }),
  (v) => ({
    title: `Contract redlines from ${v.customer} legal`,
    description: "They want uncapped liability for data breaches.",
    messages: [
      [0, "@1 their redlines are in. The liability ask is a non-starter, everything else is fine."],
      [1, "Counter with liability capped at 2x annual fees for data breaches. That's market."],
    ],
  }),
  (v) => ({
    title: `Flaky test in ${v.service}: retries time out`,
    description: "Fails about 1 in 30 runs on CI, never locally.",
    messages: [
      [0, "It's the clock. The test sleeps 100 ms and CI runners are slower under load."],
      [1, "Use the fake timer like the other suites and it'll be deterministic."],
    ],
  }),
  (v) => ({
    title: `Launch plan for ${v.codename}`,
    description: `Public launch in ${v.quarter}: blog post, changelog, email and a webinar.`,
    messages: [
      [
        0,
        `@1 draft of the blog post is ready. Headline: "${v.codename}: search that understands what you mean".`,
      ],
      [1, `Lead with the customer quote from ${v.customer}, it's stronger than our claims.`],
      [2, `Webinar slot is booked for ${v.day} at 10am PT.`],
    ],
  }),
  (v) => ({
    title: `Refund request from ${v.customer}`,
    description: "Charged twice for the annual plan after a card update.",
    messages: [
      [
        0,
        `@1 ${v.tool} shows two successful charges four minutes apart. Can you refund the second?`,
      ],
      [1, "Refunded. The retry fired because the webhook timed out; I'll make it idempotent."],
    ],
  }),
  (v) => ({
    title: `Offsite planning for ${v.quarter}`,
    description: "Two days, whole company, somewhere we can walk to dinner.",
    messages: [
      [
        0,
        "Shortlist: Lisbon, Mexico City, or staying local and spending the money on a better venue.",
      ],
      [1, "Lisbon. Direct flights for most of the team and the timezone works for everyone."],
      [2, "Please keep one afternoon with no agenda."],
    ],
  }),
  (v) => ({
    title: `Data retention policy for ${v.service}`,
    description: "Legal wants logs deleted after 90 days; analytics wants a year.",
    messages: [
      [0, "@1 can we keep aggregated metrics for a year and raw logs for 90 days?"],
      [
        1,
        "That satisfies GDPR as long as aggregates can't identify a person. Write it into the DPA.",
      ],
    ],
  }),
];

async function mutate(person: string, transactions: unknown[]): Promise<void> {
  const response = await fetch(`${API}/sync/mutate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Workspace": WORKSPACE,
      Authorization: `Bearer ${person}`,
    },
    body: JSON.stringify({ transactions }),
  });
  const { results } = (await response.json()) as { results: { ok: boolean; message?: string }[] };
  const refused = results.filter((r) => !r.ok);
  if (refused.length > 0) throw new Error(`${person}: ${refused.map((r) => r.message).join("; ")}`);
}
const create = (model: string, changes: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  kind: "create",
  model,
  modelId: crypto.randomUUID(),
  changes,
  batch: 0,
});

const titles = new Set<string>();
let messages = 0;
for (let n = 0; titles.size < COUNT && n < COUNT * 20; n++) {
  const vars: Vars = {
    customer: pick(customers),
    codename: pick(codenames),
    service: pick(services),
    quarter: pick(quarters),
    day: pick(days),
    region: pick(regions),
    tool: pick(tools),
  };
  const { title, description, messages: said } = (n === 0 ? scenarios[0] : pick(scenarios))(vars);
  if (titles.has(title)) continue;
  titles.add(title);
  // Different people in each thread; slot 0 owns it.
  const cast = people.toSorted(() => rand() - 0.5);
  const thread = create("Thread", {
    title,
    description,
    state: rand() < 0.2 ? "resolved" : "open",
    priority: pick(["none", "none", "low", "medium", "high", "urgent"]),
    ownerId: cast[0],
    workspaceId: WORKSPACE,
    labelIds: [],
    subspaceIds: [],
    assigneeIds: [],
    dueAt: rand() < 0.3 ? Date.now() + Math.floor(rand() * 21) * 86_400_000 : null,
  });
  await mutate(cast[0], [thread]);
  for (const [slot, text] of said) {
    const body = text.replace(/@(\d)/g, (_, at: string) => `[[person:${cast[Number(at)]}]]`);
    await mutate(cast[slot], [
      create("Message", {
        threadId: thread.modelId,
        authorId: cast[slot],
        body,
        workspaceId: WORKSPACE,
        subspaceIds: [],
      }),
    ]);
    messages++;
  }
}
console.log(`Made ${titles.size} threads and ${messages} messages in the local workspace.`);
