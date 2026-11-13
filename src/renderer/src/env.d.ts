interface Window {
  desktop: {
    setTheme: (theme: "dark" | "light") => void;
    google: (url: string) => Promise<string | null>;
  };
}
