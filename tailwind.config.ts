import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Be Vietnam Pro", "Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
      colors: { canvas: "#f4f5f8" },
    },
  },
  plugins: [],
} satisfies Config;
