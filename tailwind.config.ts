import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        abyss: "#05080f",
        navy: "#0a1424",
        cyan: {
          DEFAULT: "#46e3ea",
          2: "#1fb6c8",
        },
        amber: "#ffba49",
        good: "#7af0a8",
        bad: "#ff6b6b",
        text: "#e9f1f8",
        mut: "#8da0b3",
      },
      fontFamily: {
        display: ["var(--font-rajdhani)", "system-ui", "sans-serif"],
        body: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
