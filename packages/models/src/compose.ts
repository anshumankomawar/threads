// Drafting a thread from what someone typed, shared by the API (apps/api/src/compose.ts, POST /ai/compose) and the
// app's new-message panel.

export type ComposeRequest = {
  author: { id: string; name: string };
  // Who can be asked: the people @mentioned, so the model can tell who "@arjun" is and picks nobody else.
  people: { id: string; name: string }[];
  text: string;
};

type ComposeAsk = { personIds: string[]; text: string };

export type ComposeDraft = {
  title: string;
  // What the asks share: links, background. Empty when the asks say it all.
  context: string;
  asks: ComposeAsk[];
  // Kept from ⌘N's form when it's saved as a draft rather than made: who it's assigned to, its space and labels.
  assigneeIds?: string[];
  subspaceIds?: string[];
  labelIds?: string[];
};
