import type { Person } from "model";
import { createContext, useContext } from "solid-js";

// Who you're viewing the app as: an accessor, since the View As palette switches it for testing. Starts as the local
// user.
export const MeContext = createContext<() => Person>(() => ({
  id: window.user.username,
  name: "You",
}));

export const useMe = (): (() => Person) => useContext(MeContext);
