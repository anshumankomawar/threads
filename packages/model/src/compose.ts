// Drafting a thread from what someone typed, shared by the API (apps/api/src/compose.ts, POST /ai/compose) and the
// app's new-message panel.

export type ComposeRequest = {
  author: { id: string; name: string };
  // Everyone who can be asked, so the model can tell who "@arjun" is.
  people: { id: string; name: string }[];
  text: string;
};

export type ComposeAsk = { personIds: string[]; text: string };

export type ComposeDraft = {
  title: string;
  // What the asks share: links, background. Empty when the asks say it all.
  context: string;
  asks: ComposeAsk[];
};
