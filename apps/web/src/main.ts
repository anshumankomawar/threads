import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

// Signing in to Threads: Google, or a one-time code sent to your email. Only invited emails get in. Once signed in, the
// page trades the session for the Threads person you are (`POST /auth/token` on the API).

const auth = createAuthClient({ baseURL: location.origin, plugins: [emailOTPClient()] });
const root = document.querySelector<HTMLElement>("#app")!;

type Me = { personId: string; email: string; token: string } | { error: string };

// An element with its properties set and its children appended. Text goes in as text, never as HTML.
function el<Tag extends keyof HTMLElementTagNameMap>(
  tag: Tag,
  props: Partial<HTMLElementTagNameMap[Tag]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[Tag] {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
}

const show = (...children: Node[]): void => root.replaceChildren(...children);

// What went wrong, shown under the form. Google sends you back with `?error=…` when it didn't work out.
const errorLine = el("p", { className: "error", role: "alert" });
const fail = (message: string | null): void => void (errorLine.textContent = message ?? "");
fail(new URLSearchParams(location.search).get("error")?.replaceAll("_", " ") ?? null);

async function render(): Promise<void> {
  const { data } = await auth.getSession();
  if (data) signedIn(data.user.email);
  else askForEmail();
}

function askForEmail(): void {
  const google = el("button", {
    type: "button",
    className: "primary",
    textContent: "Continue with Google",
  });
  google.onclick = async () => {
    fail(null);
    const { error } = await auth.signIn.social({
      provider: "google",
      callbackURL: location.origin,
      errorCallbackURL: location.origin,
    });
    if (error) fail(error.message ?? "Google sign-in isn't available");
  };
  const email = el("input", { type: "email", placeholder: "you@company.com", required: true });
  email.setAttribute("aria-label", "Email");
  const form = el(
    "form",
    {},
    email,
    el("button", { type: "submit", textContent: "Email me a code" }),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    fail(null);
    const { error } = await auth.emailOtp.sendVerificationOtp({
      email: email.value,
      type: "sign-in",
    });
    if (error) fail(error.message ?? "That didn't work");
    else askForCode(email.value);
  };
  show(google, el("p", { className: "or", textContent: "or" }), form, errorLine);
}

function askForCode(email: string): void {
  const code = el("input", { placeholder: "6-digit code", inputMode: "numeric", required: true });
  code.setAttribute("aria-label", "Code");
  const back = el("button", {
    type: "button",
    className: "link",
    textContent: "Use another email",
  });
  back.onclick = () => askForEmail();
  const form = el(
    "form",
    {},
    el("p", { className: "muted", textContent: `If ${email} is invited, a code is on its way.` }),
    code,
    el("button", { type: "submit", textContent: "Sign in" }),
    back,
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    fail(null);
    const { error } = await auth.signIn.emailOtp({ email, otp: code.value.trim() });
    if (error) fail(error.message ?? "That code didn't work");
    else void render();
  };
  show(form, errorLine);
  code.focus();
}

function signedIn(email: string): void {
  const who = el("p", { className: "muted", textContent: "Finding you in Threads…" });
  const signOut = el("button", { type: "button", textContent: "Sign out" });
  signOut.onclick = async () => {
    await auth.signOut();
    void render();
  };
  show(el("p", {}, "Signed in as ", el("strong", { textContent: email })), who, signOut);
  void fetch("/auth/token", { method: "POST", credentials: "include" })
    .then((response) => response.json() as Promise<Me>)
    .then(
      (me) => {
        if ("error" in me) {
          who.className = "error";
          who.textContent = me.error;
        } else
          who.replaceChildren(
            "You're ",
            el("strong", { textContent: me.personId }),
            " in Threads.",
          );
      },
      () => {
        who.className = "error";
        who.textContent = "Couldn't reach Threads";
      },
    );
}

void render();
