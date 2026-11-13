import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import { createTokenInputController } from "@ui-sdk/react/token-input";
import { useEffect, useRef, useState } from "react";
import { api, parts, useMark, useMe, useNames, useSend, useThreads, type Id } from "./data";
import { Identicon } from "./Identicon";
import { MessageBox } from "./MessageBox";
import { editDraft, go, removeDraft, type Draft } from "./state";
import { ago } from "./time";

function Body({ body }: { body: string }) {
  const { name } = useNames();
  return parts(body).map((part, index) =>
    typeof part === "string" ? (
      part
    ) : (
      <span key={index} className="mention">
        @{name(part.id)}
      </span>
    ),
  );
}

function Compose(props: Parameters<typeof MessageBox>[0]) {
  const me = useMe()!;
  return (
    <section className="turn">
      <Identicon seed={me._id} />
      <div>
        <div className="meta">
          <b>{me.name}</b>
        </div>
        <MessageBox {...props} />
      </div>
    </section>
  );
}

export function DraftView({ draft }: { draft: Draft }) {
  const start = useMutation(api.threads.start);
  const send = async (body: string) => {
    removeDraft(draft.id);
    go({ thread: await start({ body }) });
  };
  return (
    <main className="thread">
      <article>
        <Compose
          key={draft.id}
          label="Draft"
          placeholder="Write a message, @mention who it's for, ⌘↵ to send"
          defaultText={draft.text}
          onSend={(body) => void send(body)}
          onChange={(text) => editDraft(draft.id, text)}
        />
      </article>
    </main>
  );
}

export function Thread({ threadId }: { threadId: Id<"threads"> }) {
  const messages = useQuery(api.threads.messages, { threadId }) ?? [];
  const unread = useThreads().find((row) => row.threadId === threadId)?.unread;
  const { name } = useNames();
  const send = useSend();
  const mark = useMark();
  const [reply] = useState(createTokenInputController);
  const turns = messages.reduce<(typeof messages)[]>((turns, message) => {
    if (turns.at(-1)?.[0].authorId === message.authorId) turns.at(-1)!.push(message);
    else turns.push([message]);
    return turns;
  }, []);
  const end = useRef<HTMLDivElement>(null);

  useShortcut("r", () => reply.focus(), { description: "Reply" });
  useEffect(() => {
    if (unread) void mark({ threadId, unread: false });
  }, [threadId, unread, mark]);
  useEffect(() => {
    void end.current?.scrollIntoView({ block: "end" });
  }, [threadId, messages.length]);

  return (
    <main className="thread">
      <article>
        {turns.map((turn) => (
          <section key={turn[0]._id} className="turn">
            <Identicon seed={turn[0].authorId} />
            <div>
              <div className="meta">
                <b>{name(turn[0].authorId)}</b>
                <time>{ago(turn[0]._creationTime)}</time>
              </div>
              {turn.map((message) => (
                <p key={message._id} className={message === messages[0] ? "text title" : "text"}>
                  <Body body={message.body} />
                </p>
              ))}
            </div>
          </section>
        ))}
        <Compose
          key={threadId}
          input={reply}
          label="Reply"
          placeholder="Reply, @mention someone to bring them in, ⌘↵ to send"
          onSend={(body) => void send({ threadId, body })}
        />
        <div ref={end} />
      </article>
    </main>
  );
}
