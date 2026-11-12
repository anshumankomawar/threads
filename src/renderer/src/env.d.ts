/// <reference types="vite/client" />

interface Window {
  desktop: {
    setTheme: (theme: "dark" | "light") => void;
  };
}
