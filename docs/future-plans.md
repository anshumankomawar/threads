# Future plans

Product ideas we've looked into and parked, with what we found, so whoever picks one up (person or agent) starts
from the research instead of redoing it. Sync-engine features that aren't built yet live in
[architecture.md](architecture.md#not-built-yet). When you build something from here, move what's still true into
the architecture doc and delete the entry.

## Video calls in meeting threads

**Status:** researched 2026-11-01, not started.

**Want:** a simple video call people in the org can join from a meeting thread, inline (in the thread or the split
pane). No external guests yet. We don't want to host media servers ourselves.

**Today:** every meeting gets a `call` entry with `DUMMY_ZOOM_LINK` (`packages/model/src/model.ts`), added by the
engine when a meeting thread is created.

**Options (hosted, embedded):** prices as listed on each vendor's pricing page on 2026-11-01. A participant-minute
is one person on a call for one minute.

| Option                 | Free each month                       | After that                                | Embedding                                                          |
| ---------------------- | ------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| Daily (Prebuilt)       | 10,000 participant-minutes            | $0.004/participant-minute, no monthly fee | Ready-made call component; least work                              |
| Zoom Video SDK         | 10,000 minutes                        | $0.0035/minute                            | You build the call UI (UI toolkit available); credit-based billing |
| Cloudflare RealtimeKit | none listed (beta)                    | $0.002/participant-minute, audio $0.0005  | Ready-made meeting UI kit; same Cloudflare account as the API      |
| LiveKit Cloud          | 5,000 minutes                         | $50/month plan with 150,000 minutes       | Good open-source components; abrupt price step                     |
| Jitsi as a Service     | 25 monthly active users (per user)    | $99/month up to 300 users                 | Jitsi's look, not ours                                             |
| Whereby Embedded       | 2,000 minutes, calls capped at 30 min | $10.99/month, then $0.0042/minute         | Simple embed; free tier unusable for real meetings                 |

Rough cost for 10 people with about 5 hours of calls each a week (~13,000 participant-minutes a month): Zoom ~$10,
Daily ~$12, RealtimeKit ~$26, Whereby ~$46, LiveKit $50, Jitsi $0 (under 25 users).

Zoom's Meeting SDK (embedding real Zoom meetings) was ruled out: it needs Marketplace review to join meetings outside
your own account and shows Zoom's UI. Zoom Apps run inside the Zoom client, the opposite direction.

**Recommendation:** Daily Prebuilt, for the least work and a free tier that lasts. Runner-up: Cloudflare RealtimeKit,
to keep everything on one Cloudflare account at half Daily's rate (check it's out of beta and what it charges).

**How it would fit:** still one thread, no new types.

1. When a meeting thread is created, the engine creates the room through the provider's REST API instead of using
   `DUMMY_ZOOM_LINK`, and stores its URL on the `call` entry (`link`). The provider's API key is a Worker secret
   (`bindings.secret()` in `cloudflare.config.ts`), like `API_TOKEN`.
2. Joining: the client asks the API for a short-lived join token for that room (a new route on the Workspace object;
   only workspace members get one), then mounts the provider's call component in `CallBlock` (or the split pane).
3. Later: recordings or transcripts come back as entries on the same thread (`notes`, or messages), so the meeting's
   record stays in the thread.

Sources: [Daily](https://www.daily.co/pricing/video-sdk/),
[Zoom Video SDK rates](https://explore.zoom.us/docs/en-us/video-sdk-rates.html),
[Cloudflare RealtimeKit](https://developers.cloudflare.com/realtime/realtimekit/pricing/),
[LiveKit](https://livekit.com/pricing),
[JaaS](https://cpaas.8x8.com/en/pricing/jitsi-as-a-service-pricing/),
[Whereby Embedded](https://whereby.com/information/embedded/pricing/).
