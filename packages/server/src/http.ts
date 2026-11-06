import { Refusal, type Session, type SyncServer } from "./server";

const STATUS = { forbidden: 403, invalid: 400, conflict: 409, not_found: 404 } as const;
const encoder = new TextEncoder();

const list = (value: string | null): string[] => (value ? value.split(",") : []);

// The spec's endpoints for one session. The WebSocket (/sync/socket) is the Durable Object's. `?subscribed=` names the
// groups the client follows without being in them; `?holds=` and `?after=` make a bootstrap partial.
export async function handleRequest(
  server: SyncServer,
  request: Request,
  resolved: Session,
): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  const route = `${request.method} ${pathname}`;
  const session: Session =
    "userId" in resolved
      ? { ...resolved, subscribed: list(searchParams.get("subscribed")) }
      : resolved;
  try {
    if (route === "GET /sync/bootstrap") {
      const after = searchParams.get("after");
      const partial =
        after === null
          ? undefined
          : { holds: list(searchParams.get("holds")), after: Number(after) };
      const { rows, end } = server.bootstrap(session, partial);
      const lines = [...rows, end].values();
      const body = new ReadableStream({
        pull(controller) {
          const line = lines.next();
          if (line.done) controller.close();
          else controller.enqueue(encoder.encode(`${JSON.stringify(line.value)}\n`));
        },
      });
      return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
    }
    if (route === "GET /sync/deltas")
      return Response.json(server.deltas(session, Number(searchParams.get("after"))));
    if (route === "POST /sync/mutate")
      return Response.json(server.mutate(session, await request.json()));
    if (request.method === "POST" && pathname.startsWith("/actions/"))
      return Response.json(
        server.action(session, pathname.slice("/actions/".length), await request.json()),
      );
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    return Response.json(
      { code: error.code, message: error.message },
      { status: STATUS[error.code] },
    );
  }
  return Response.json({ code: "not_found", message: `No route ${route}` }, { status: 404 });
}
