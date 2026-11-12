import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api, useBuckets, useGroups, useMe, usePeople, type Doc, type Id } from "./data";
import { reset, setTheme, useUI, type Theme } from "./state";

const THEMES: Theme[] = ["dark", "light"];

function BucketForm({ bucket }: { bucket?: Doc<"buckets"> }) {
  const save = useMutation(api.workspace.saveBucket);
  const remove = useMutation(api.workspace.removeBucket);
  return (
    <form
      action={(form) =>
        void save({
          id: bucket?._id,
          name: String(form.get("name")),
          description: String(form.get("description")),
        })
      }
    >
      <input name="name" placeholder="New bucket" defaultValue={bucket?.name} required />
      <input
        name="description"
        placeholder="What belongs in it"
        defaultValue={bucket?.description}
        required
      />
      <button>{bucket ? "Save" : "Add"}</button>
      {bucket && (
        <button type="button" onClick={() => void remove({ id: bucket._id })}>
          Delete
        </button>
      )}
    </form>
  );
}

function GroupForm({ group }: { group?: Doc<"groups"> }) {
  const people = usePeople();
  const save = useMutation(api.workspace.saveGroup);
  const remove = useMutation(api.workspace.removeGroup);
  return (
    <form
      action={(form) =>
        void save({
          id: group?._id,
          name: String(form.get("name")),
          userIds: form.getAll("userIds") as Id<"users">[],
        })
      }
    >
      <input name="name" placeholder="New group" defaultValue={group?.name} required />
      <span className="choices">
        {people.map((person) => (
          <label key={person._id}>
            <input
              type="checkbox"
              name="userIds"
              value={person._id}
              defaultChecked={group?.userIds.includes(person._id)}
            />
            {person.name}
          </label>
        ))}
      </span>
      <button>{group ? "Save" : "Add"}</button>
      {group && (
        <button type="button" onClick={() => void remove({ id: group._id })}>
          Delete
        </button>
      )}
    </form>
  );
}

export function Settings() {
  const me = useMe()!;
  const people = usePeople();
  const groups = useGroups();
  const buckets = useBuckets();
  const theme = useUI((ui) => ui.theme);
  const invite = useMutation(api.workspace.invite);
  const { signOut } = useAuthActions();

  return (
    <main className="settings">
      <article>
        <h1>Settings</h1>

        <h2>Account</h2>
        <p>
          {me.name}, {me.email}, in {me.workspace}
        </p>
        <button onClick={() => void signOut().then(reset)}>Sign Out</button>

        <h2>Appearance</h2>
        <div className="choices">
          {THEMES.map((name) => (
            <button key={name} aria-pressed={theme === name} onClick={() => setTheme(name)}>
              {name}
            </button>
          ))}
        </div>

        <h2>Buckets</h2>
        <p>New threads are sorted into the bucket whose description fits them best.</p>
        {buckets.map((bucket) => (
          <BucketForm key={bucket._id} bucket={bucket} />
        ))}
        <BucketForm />

        <h2>Groups</h2>
        <p>Mention a group to bring everyone in it into a thread.</p>
        {groups.map((group) => (
          <GroupForm key={group._id} group={group} />
        ))}
        <GroupForm />

        <h2>People</h2>
        <p>{people.map((person) => person.name).join(", ")}</p>
        <form action={(form) => void invite({ email: String(form.get("email")) })}>
          <input name="email" type="email" placeholder="Invite by email" required />
          <button>Invite</button>
        </form>
      </article>
    </main>
  );
}
