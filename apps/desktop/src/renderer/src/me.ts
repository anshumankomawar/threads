import type { Person } from "model";
import { createContext, useContext } from "react";

// Who you're viewing the app as. Starts as the local user; the View As palette switches it for testing.
export const MeContext = createContext<Person>({ id: window.user.username, name: "You" });

export const useMe = (): Person => useContext(MeContext);
