import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { usePreference } from "@ui-sdk/react/preferences";
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { useMutation } from "convex/react";
import { useState } from "react";
import {
  api,
  useBuckets,
  useCopyInvite,
  useGroups,
  useMe,
  usePeople,
  type Doc,
  type Id,
} from "./data";
import { reset, theme } from "./state";

function TextField(props: { name: string; label: string; of: string; value?: string }) {
  return (
    <Field name={props.name}>
      <FieldLabel className="hidden">
        {props.label} of {props.of}
      </FieldLabel>
      <Input placeholder={props.label} defaultValue={props.value} required />
    </Field>
  );
}

function BucketForm({ bucket }: { bucket?: Doc<"buckets"> }) {
  const save = useMutation(api.workspace.saveBucket);
  const remove = useMutation(api.workspace.removeBucket);
  const of = bucket?.name ?? "a new bucket";
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
      <TextField name="name" label="Name" of={of} value={bucket?.name} />
      <TextField
        name="description"
        label="What belongs in it"
        of={of}
        value={bucket?.description}
      />
      <Button type="submit" aria-label={`Save ${of}`}>
        {bucket ? "Save" : "Add"}
      </Button>
      {bucket && (
        <Button aria-label={`Delete ${of}`} onClick={() => void remove({ id: bucket._id })}>
          Delete
        </Button>
      )}
    </form>
  );
}

function GroupForm({ group }: { group?: Doc<"groups"> }) {
  const people = usePeople();
  const save = useMutation(api.workspace.saveGroup);
  const remove = useMutation(api.workspace.removeGroup);
  const of = group?.name ?? "a new group";
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
      <TextField name="name" label="Name" of={of} value={group?.name} />
      <span className="choices">
        {people.map((person) => (
          <label key={person._id}>
            <Checkbox
              name="userIds"
              value={person._id}
              defaultChecked={group?.userIds.includes(person._id)}
              aria-label={`${person.name} in ${of}`}
            >
              <CheckboxIndicator>✓</CheckboxIndicator>
            </Checkbox>
            {person.name}
          </label>
        ))}
      </span>
      <Button type="submit" aria-label={`Save ${of}`}>
        {group ? "Save" : "Add"}
      </Button>
      {group && (
        <Button aria-label={`Delete ${of}`} onClick={() => void remove({ id: group._id })}>
          Delete
        </Button>
      )}
    </form>
  );
}

export function Settings() {
  const me = useMe()!;
  const people = usePeople();
  const groups = useGroups();
  const buckets = useBuckets();
  const { value } = usePreference(theme);
  const copyInvite = useCopyInvite();
  const [copied, setCopied] = useState(false);
  const { signOut } = useAuthActions();

  return (
    <main className="settings">
      <article>
        <h1>Settings</h1>

        <h2>Account</h2>
        <p>
          {me.name}, {me.email}, in {me.workspace}
        </p>
        <Button onClick={() => void signOut().then(reset)}>Sign Out</Button>

        <h2>Appearance</h2>
        <SegmentedControl
          aria-label="Theme"
          value={value}
          onValueChange={(next) => next && theme.set(next as typeof value)}
        >
          <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
          <SegmentedControlItem value="light">Light</SegmentedControlItem>
        </SegmentedControl>

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
        <p>Anyone who signs in and pastes the invite link joins {me.workspace}.</p>
        <Button onClick={() => void copyInvite().then(() => setCopied(true))}>
          {copied ? "Copied" : "Copy Invite Link"}
        </Button>
      </article>
    </main>
  );
}
