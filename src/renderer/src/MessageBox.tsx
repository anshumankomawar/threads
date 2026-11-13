import {
  createTokenInputController,
  fromText,
  toText,
  TokenInput,
  TokenInputEditor,
  TokenInputToken,
  type TokenCodec,
} from "@ui-sdk/react/token-input";
import {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuItem,
  TriggerMenuList,
  type TriggerMenuDataItem,
} from "@ui-sdk/react/trigger-menu";
import { useMemo, useState } from "react";
import { parts, useGroups, useMe, useNames, usePeople } from "./data";
import { Identicon } from "./Identicon";

export function MessageBox(props: {
  label: string;
  placeholder: string;
  defaultText?: string;
  input?: ReturnType<typeof createTokenInputController>;
  onSend: (body: string) => void;
  onChange?: (text: string) => void;
}) {
  const me = useMe();
  const people = usePeople();
  const groups = useGroups();
  const { name } = useNames();
  const [own] = useState(createTokenInputController);
  const input = props.input ?? own;

  const codec = useMemo<TokenCodec>(
    () => ({
      format: (token) => `[[${token.value}]]`,
      parse: (text) =>
        parts(text).map((part) =>
          typeof part === "string"
            ? part
            : { type: "mention", value: `${part.kind}:${part.id}`, label: name(part.id) },
        ),
    }),
    [name],
  );
  const mentionable = [
    ...people
      .filter((person) => person._id !== me?._id)
      .map((person) => ({ value: `person:${person._id}`, label: person.name })),
    ...groups.map((group) => ({ value: `group:${group._id}`, label: group.name })),
  ];

  return (
    <TokenInput
      controller={input}
      codec={codec}
      defaultValue={fromText(props.defaultText ?? "", codec)}
      submitShortcut="mod+enter"
      onValueChange={(value) => props.onChange?.(toText(value, codec))}
      onSubmit={(value) => {
        const body = toText(value, codec).trim();
        if (!body) return;
        props.onSend(body);
        input.clear();
      }}
      renderToken={(token) => <TokenInputToken className="mention">@{token.label}</TokenInputToken>}
    >
      <TokenInputEditor
        className="editor"
        aria-label={props.label}
        placeholder={props.placeholder}
      />
      <TriggerMenu triggers={[{ char: "@", type: "mention", items: mentionable }]}>
        <TriggerMenuContent className="panel options" sideOffset={6}>
          <TriggerMenuList>
            {(state) =>
              (state.items as TriggerMenuDataItem<string>[]).map((item) => (
                <TriggerMenuItem key={item.value} value={item.value} label={item.label}>
                  <Identicon seed={item.value.split(":")[1]} size={18} />
                  {item.label}
                </TriggerMenuItem>
              ))
            }
          </TriggerMenuList>
        </TriggerMenuContent>
      </TriggerMenu>
    </TokenInput>
  );
}
