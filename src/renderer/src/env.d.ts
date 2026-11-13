interface Window {
  desktop: {
    saved: () => void;
    setTheme: (theme: "dark" | "light") => void;
    google: (url: string) => Promise<string | null>;
  };
}
