interface Window {
  desktop: {
    invite: () => Promise<string | null>;
    onInvite: (run: () => void) => () => void;
    saved: () => void;
    setTheme: (theme: "dark" | "light") => void;
    google: (url: string) => Promise<string | null>;
  };
}
