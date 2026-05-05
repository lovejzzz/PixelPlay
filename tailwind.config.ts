import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"VT323"', '"Press Start 2P"', "ui-monospace", "monospace"],
      },
      colors: {
        farm: {
          sky: "#a7d8e8",
          grass: "#7cb86b",
          dirt: "#8a5a3b",
          wood: "#6b4423",
          parchment: "#f4e4bc",
          ink: "#2b1810",
        },
      },
      boxShadow: {
        pixel: "4px 4px 0 0 rgba(43, 24, 16, 0.9)",
      },
    },
  },
  plugins: [],
};
export default config;
