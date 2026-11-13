import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@ui-sdk/react/button";
import { Checkbox, CheckboxGroup } from "@ui-sdk/react/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { Input } from "@ui-sdk/react/input";
import { usePreference } from "@ui-sdk/react/preferences";
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/react/segmented-control";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import { Textarea } from "@ui-sdk/react/textarea";
import { useMutation } from "convex/react";
import { useState, type FocusEvent, type ReactNode } from "react";
import {
  api,
  useBuckets,
  useCopyInvite,
  useGroups,
  useMe,
  usePeople,
  useRemoveBucket,
  type Doc,
  type Id,
} from "./data";
import { Identicon } from "./Identicon";
import { reset, setDialog, theme, useUI } from "./state";

const saveOnLeave = (event: FocusEvent<HTMLFormElement>) => {
  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.requestSubmit();
};

function Section(props: { title: string; heading?: string; hint: string; children: ReactNode }) {
  return (
    <TabsPanel value={props.title}>
      <h2>{props.heading ?? props.title}</h2>
      <p>{props.hint}</p>
      {props.children}
    </TabsPanel>
  );
}

function Bucket({ bucket }: { bucket?: Doc<"buckets"> }) {
  const save = useMutation(api.workspace.saveBucket);
  const remove = useRemoveBucket();
  const of = bucket?.name ?? "a new bucket";
  return (
    <form
      className="row"
      onBlur={saveOnLeave}
      action={async (form) => {
        const name = String(form.get("name")).trim();
        const description = String(form.get("description")).trim();
        if (!name || (name === bucket?.name && description === bucket.description)) return;
        await save({ id: bucket?._id, name, description });
      }}
    >
      <Input
        name="name"
        className="name"
        aria-label={`Name of ${of}`}
        placeholder="Add a bucket"
        defaultValue={bucket?.name}
      />
      <Textarea
        name="description"
        rows={1}
        autoResize
        submitShortcut="enter"
        aria-label={`What belongs in ${of}`}
        placeholder="What belongs in it"
        defaultValue={bucket?.description}
      />
      {bucket && (
        <Button className="quiet" onClick={() => void remove(bucket)}>
          Delete
        </Button>
      )}
    </form>
  );
}

function Group({ group }: { group?: Doc<"groups"> }) {
  const people = usePeople();
  const save = useMutation(api.workspace.saveGroup);
  const remove = useMutation(api.workspace.removeGroup);
  const of = group?.name ?? "a new group";
  return (
    <form
      className="row"
      onBlur={saveOnLeave}
      action={async (form) => {
        const name = String(form.get("name")).trim();
        const userIds = form.getAll("userIds") as Id<"users">[];
        if (!name || (name === group?.name && userIds.join() === group.userIds.join())) return;
        await save({ id: group?._id, name, userIds });
      }}
    >
      <Input
        name="name"
        className="name"
        aria-label={`Name of ${of}`}
        placeholder="Add a group"
        defaultValue={group?.name}
      />
      {group && (
        <>
          <CheckboxGroup
            name="userIds"
            className="chips"
            aria-label={`People in ${of}`}
            defaultValue={group.userIds}
            onValueChange={(userIds) =>
              void save({ id: group._id, name: group.name, userIds: userIds as Id<"users">[] })
            }
          >
            {people.map((person) => (
              <Checkbox key={person._id} value={person._id}>
                {person.name}
              </Checkbox>
            ))}
          </CheckboxGroup>
          <Button className="quiet" onClick={() => void remove({ id: group._id })}>
            Delete
          </Button>
        </>
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
    <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
      <DialogContent className="panel settings">
        <DialogTitle className="hidden">Settings</DialogTitle>
        <Tabs defaultValue={useUI.getState().tab} orientation="vertical">
          <TabsList>
            {["Workspace", "Account", "Appearance", "Buckets", "Groups"].map((title) => (
              <TabsTab key={title} value={title}>
                {title}
              </TabsTab>
            ))}
          </TabsList>

          <Section
            title="Workspace"
            heading={me.workspace}
            hint="Members of this workspace. Anyone with the invite link can join."
          >
            <div className="people">
              {people.map((person) => (
                <div key={person._id} className="row">
                  <Identicon seed={person._id} size={20} />
                  <span className="clip">{person.name}</span>
                  <small>{person.email}</small>
                </div>
              ))}
            </div>
            <div className="row">
              <span className="clip">Invite people</span>
              <Button onClick={() => void copyInvite().then(() => setCopied(true))}>
                {copied ? "Copied" : "Copy Invite Link"}
              </Button>
            </div>
          </Section>

          <Section title="Account" hint="Signed in with Google.">
            <div className="row">
              <Identicon seed={me._id} size={20} />
              <span className="clip">{me.name}</span>
              <small>{me.email}</small>
              <Button onClick={() => void signOut().then(reset)}>Sign Out</Button>
            </div>
          </Section>

          <Section title="Appearance" hint="How Arc looks on this Mac.">
            <div className="row">
              <span className="clip">Theme</span>
              <SegmentedControl
                aria-label="Theme"
                value={value}
                onValueChange={(next) => next && theme.set(next as typeof value)}
              >
                <SegmentedControlItem value="dark">Dark</SegmentedControlItem>
                <SegmentedControlItem value="light">Light</SegmentedControlItem>
              </SegmentedControl>
            </div>
          </Section>

          <Section
            title="Buckets"
            hint="A new thread goes to the bucket whose description fits it best."
          >
            {buckets.map((bucket) => (
              <Bucket key={bucket._id} bucket={bucket} />
            ))}
            <Bucket key={buckets.length} />
          </Section>

          <Section title="Groups" hint="Mention a group to bring everyone in it into a thread.">
            {groups.map((group) => (
              <Group key={group._id} group={group} />
            ))}
            <Group key={groups.length} />
          </Section>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
