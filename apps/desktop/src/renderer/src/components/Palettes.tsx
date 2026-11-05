import { createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic, type JSX } from "@solidjs/web";
import * as stylex from "@stylexjs/stylex";
import { Bucket, Conversation, Message, Team, User } from "models";
import {
  account,
  applyTheme,
  dialog,
  me,
  open,
  setDialog,
  signOut,
  source,
  SOURCES,
  store,
  switchTo,
  theme,
  type Dialog,
  type Source,
} from "../session";
import { menu } from "../styles/controls";
import { paletteSectionMarker } from "../styles/markers.stylex";
import { palette } from "../styles/palette";
import { sx } from "../styles/sx";
import { Compose } from "./Compose";
import { Identicon } from "./Identicon";

// A modal palette: a click outside or Escape closes it.
export function Modal(props: { onClose?: () => void; children: JSX.Element }): JSX.Element {
  return (
    <dialog
      ref={(el) => queueMicrotask(() => ((el.closedBy = "any"), el.showModal()))}
      onClose={() => (props.onClose?.(), setDialog(null))}
      class={sx(palette.dialog, palette.open)}
    >
      {props.children}
    </dialog>
  );
}

// `section` heads a run of rows; `hint` sits on the right, like a shortcut.
type Row = { label: string; hint?: string; seed?: string; section?: string; run: () => void };

// An input over rows that match it, in sections; arrows choose, Enter or a click runs the row.
function Picker(props: { placeholder: string; rows: (query: string) => Row[] }): JSX.Element {
  const [query, setQuery] = createSignal("");
  const [at, setAt] = createSignal(0);
  const rows = createMemo(() => props.rows(query().trim()));
  const index = (): number => Math.min(at(), rows().length - 1);
  const sections = createMemo(() =>
    rows().reduce<{ title?: string; rows: { row: Row; at: number }[] }[]>((out, row, at) => {
      if (out.length === 0 || out.at(-1)!.title !== row.section)
        out.push({ title: row.section, rows: [] });
      out.at(-1)!.rows.push({ row, at });
      return out;
    }, []),
  );
  const onKeyDown = (event: KeyboardEvent): void => {
    const by = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (by) setAt((index() + by + rows().length) % rows().length);
    else if (event.key === "Enter") rows()[index()]?.run();
    else return;
    event.preventDefault();
  };
  return (
    <Modal>
      <div class={sx(palette.inputRow)}>
        <input
          autofocus
          class={sx(palette.input)}
          placeholder={props.placeholder}
          spellcheck={false}
          value={query()}
          onInput={(event) => (setQuery(event.currentTarget.value), setAt(0))}
          onKeyDown={onKeyDown}
        />
      </div>
      <Show when={rows().length > 0}>
        <div class={sx(palette.results)} role="listbox">
          <For each={sections()}>
            {(section) => (
              <div {...stylex.attrs(palette.section, palette.divided, paletteSectionMarker)}>
                <Show when={section.title}>
                  <div class={sx(palette.sectionLabel, palette.labelText)}>{section.title}</div>
                </Show>
                <For each={section.rows}>
                  {({ row, at }) => (
                    <button
                      class={sx(menu.item, at === index() && menu.itemSelected)}
                      role="option"
                      aria-selected={at === index() ? "true" : "false"}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setAt(at)}
                      onClick={() => row.run()}
                    >
                      <Show when={row.seed}>{(seed) => <Identicon seed={seed()} size={16} />}</Show>
                      <span class={sx(palette.rowLabel)}>{row.label}</span>
                      <Show when={row.hint}>
                        <span class={sx(palette.shortcut)}>{row.hint}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Modal>
  );
}

const matches = (text: string, query: string): boolean =>
  text.toLowerCase().includes(query.toLowerCase());
const done = (run: () => void) => () => (setDialog(null), run());
// The one row a text step has: Enter takes what you typed.
const entry = (query: string, label: string, run: (text: string) => void): Row[] =>
  query === "" ? [] : [{ label: `${label} “${query}”`, hint: "↵", run: done(() => run(query)) }];
const people = (query: string, run: (user: User) => void): Row[] =>
  store
    .all(User)
    .filter((u) => u.id !== me().id && matches(u.name, query))
    .map((u) => ({ label: u.name, seed: u.id, run: () => run(u) }));

export const everyone = (): Team => store.findById(Team, "everyone")!;

export function startConversation(
  title: string,
  team: Team,
  extra: Partial<Conversation> = {},
): Conversation {
  const conversation = store.create(Conversation, {
    title,
    state: "open",
    priority: "none",
    team,
    owner: me(),
    ...extra,
  });
  open({ conversation: conversation.id });
  return conversation;
}

export function send(conversation: Conversation, body: string, to: User[] = []): void {
  store.create(Message, {
    conversation,
    author: me(),
    body,
    toIds: to.map((u) => u.id),
    teamId: conversation.teamId,
  });
}

function Search(): JSX.Element {
  const commands = (): Row[] => [
    {
      label: "New conversation",
      hint: "⌘ N",
      section: "Quick actions",
      run: () => setDialog({ kind: "newConversation" }),
    },
    { label: "New team", section: "Quick actions", run: () => setDialog({ kind: "newTeam" }) },
    {
      label: theme() === "dark" ? "Switch to light mode" : "Switch to dark mode",
      section: "Views",
      run: done(() => applyTheme(theme() === "dark" ? "light" : "dark")),
    },
    // Signing in is the Local source's for now (the sign-in page talks to the local API); signed in, you can't view as
    // anyone else.
    ...(account
      ? [
          {
            label: `Sign out (${account.email})`,
            section: "Account",
            run: done(() => void signOut()),
          },
        ]
      : source === "local"
        ? [
            {
              label: "Sign in…",
              section: "Account",
              run: () => {
                void window.requestAuth();
                setDialog({ kind: "signIn" });
              },
            },
          ]
        : []),
    ...(account
      ? []
      : [
          {
            label: "View as…",
            hint: "⌘ U",
            section: "Data",
            run: () => setDialog({ kind: "viewAs" }),
          },
        ]),
    ...(Object.keys(SOURCES) as Source[])
      .filter((s) => s !== source)
      .map((s) => ({
        label: `Use ${SOURCES[s]} data`,
        section: "Data",
        run: () => switchTo({ source: s }),
      })),
  ];
  return (
    <Picker
      placeholder="Search…"
      rows={(query) =>
        [
          ...commands(),
          ...store.all(User).map((u) => ({
            label: u.name,
            hint: [u.level, u.role].filter(Boolean).join(" · ") || undefined,
            section: "People",
            seed: u.id,
            run: done(() => open({ person: u.id })),
          })),
          ...store.all(Team).map((t) => ({
            label: t.name,
            section: "Teams",
            run: done(() => open({ team: t.id })),
          })),
          ...store.all(Conversation).map((c) => ({
            label: c.title,
            section: "Conversations",
            run: done(() => open({ conversation: c.id })),
          })),
        ].filter((row) => matches(row.label, query))
      }
    />
  );
}

function NewConversation(props: { teamId?: string; to?: User }): JSX.Element {
  const team = (): Team => store.findById(Team, props.teamId ?? "") ?? everyone();
  return (
    <Picker
      placeholder={
        props.to ? `What do you need from ${props.to.name}?` : `New conversation in ${team().name}`
      }
      rows={(query) =>
        entry(query, "Start", (title) => {
          const conversation = startConversation(title, team());
          if (props.to) send(conversation, title, [props.to]);
        })
      }
    />
  );
}

function NewTeam(): JSX.Element {
  return (
    <Picker
      placeholder="Name the team"
      rows={(query) =>
        entry(query, "Make team", (name) => {
          const team = store.create(Team, {
            name,
            workspace: me().workspace,
            memberIds: [me().id],
          });
          open({ team: team.id });
        })
      }
    />
  );
}

// `/blocked`: ask someone for what this needs, in a conversation that keeps this one blocked until it's resolved.
function Blocked(props: { conversation: Conversation }): JSX.Element {
  const [person, setPerson] = createSignal<User | null>(null);
  return (
    <Show
      when={person()}
      keyed
      fallback={
        <Picker placeholder="Who are you waiting on?" rows={(query) => people(query, setPerson)} />
      }
    >
      {(who) => (
        <Picker
          placeholder={`What do you need from ${who.name}?`}
          rows={(query) =>
            entry(query, "Ask", (title) => {
              const asked = startConversation(title, props.conversation.team, {
                blocks: props.conversation,
              });
              send(asked, title, [who]);
            })
          }
        />
      )}
    </Show>
  );
}

// A bucket's name, then what goes in it (which the model reads).
function BucketEditor(props: { bucket?: Bucket }): JSX.Element {
  const [name, setName] = createSignal<string | null>(null);
  return (
    <Show
      when={name()}
      keyed
      fallback={
        <Picker
          placeholder={props.bucket?.name ?? "Name the bucket"}
          rows={(query) => entry(query || (props.bucket?.name ?? ""), "Name it", setName)}
        />
      }
    >
      {(named) => (
        <Picker
          placeholder={props.bucket?.description ?? `What goes in ${named}?`}
          rows={(query) =>
            entry(query || (props.bucket?.description ?? ""), "Describe it as", (description) => {
              if (!props.bucket) {
                store.create(Bucket, {
                  user: me(),
                  name: named,
                  description,
                  position: store.all(Bucket).length,
                });
                return;
              }
              props.bucket.name = named;
              props.bucket.description = description;
              props.bucket.save();
            })
          }
        />
      )}
    </Show>
  );
}

function ViewAs(): JSX.Element {
  return (
    <Picker
      placeholder="View as…"
      rows={(query) => people(query, (u) => switchTo({ viewer: u.id }))}
    />
  );
}

// Signing in happens in the browser, which sends you back here on a `threads://` link. When the link doesn't open the
// app, the sign-in page shows a code to paste here instead.
function SignIn(): JSX.Element {
  return (
    <Picker
      placeholder="Signing in in your browser… or paste the code it shows"
      rows={(query) =>
        entry(
          query.trim(),
          "Sign in with code",
          (code) => void window.authenticate({ token: code }),
        )
      }
    />
  );
}

const PALETTES = {
  search: Search,
  newConversation: NewConversation,
  newTeam: NewTeam,
  blocked: Blocked,
  bucket: BucketEditor,
  viewAs: ViewAs,
  signIn: SignIn,
  compose: Compose,
};

export function Palettes(): JSX.Element {
  return (
    <Show when={dialog()} keyed>
      {(shown: Dialog) => (
        <Dynamic component={PALETTES[shown.kind] as (props: Dialog) => JSX.Element} {...shown} />
      )}
    </Show>
  );
}
