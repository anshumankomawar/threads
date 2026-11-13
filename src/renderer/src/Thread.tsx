import { useQuery } from "convex-helpers/react/cache";
import { useShortcut } from "@ui-sdk/react/shortcuts";
import { createTokenInputController } from "@ui-sdk/react/token-input";
import { useEffect, useRef, useState } from "react";
import { api, parts, useMark, useMe, useNames, useSend, useThreads, type Id } from "./data";
import { Identicon } from "./Identicon";
import { MessageBox } from "./MessageBox";
import { ago } from "./time";

export function Body({ body }: { body: string }) {
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

export function Thread({ threadId }: { threadId: Id<"threads"> }) {
  const messages = useQuery(api.threads.messages, { threadId }) ?? [];
  const unread = useThreads().find((row) => row.threadId === threadId)?.unread;
  const me = useMe()!;
  const { name } = useNames();
  const send = useSend();
  const mark = useMark();
  const [reply] = useState(createTokenInputController);
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
        {messages.map((message, index) => (
          <section key={message._id} className="turn">
            <Identicon seed={message.authorId} />
            <div>
              <div className="meta">
                <b>{name(message.authorId)}</b>
                <time>{ago(message._creationTime)}</time>
              </div>
              <p className={index === 0 ? "text title" : "text"}>
                <Body body={message.body} />
              </p>
            </div>
          </section>
        ))}
        <section className="turn">
          <Identicon seed={me._id} />
          <div>
            <div className="meta">
              <b>{me.name}</b>
            </div>
            <MessageBox
              key={threadId}
              input={reply}
              label="Reply"
              placeholder="Reply, @mention someone to bring them in, ⌘↵ to send"
              onSend={(body) => void send(threadId, body)}
            />
          </div>
        </section>
        <div ref={end} />
      </article>
    </main>
  );
}
