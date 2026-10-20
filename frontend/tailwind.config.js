/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#f9f9f9",
          dim: "#dadada",
          bright: "#ffffff",
          lowest: "#ffffff",
          low: "#f3f3f3",
          container: "#eeeeee",
          high: "#e8e8e8",
          highest: "#e2e2e2",
          dark: "#111318",
          darkcard: "#181b22",
        },
        "on-surface": {
          DEFAULT: "#1a1c1c",
          variant: "#444748",
        },
        outline: {
          DEFAULT: "#747878",
          variant: "#c4c7c7",
          subtle: "#e2e2e2",
        },
        primary: {
          DEFAULT: "#111111",
          hover: "#222222",
          on: "#ffffff",
        },
        accent: {
          primary: "#6366f1",
          hover: "#4f46e5",
          glow: "rgba(99, 102, 241, 0.15)",
          monad: "#836ef9",
        },
        success: {
          DEFAULT: "#059669",
          container: "#ecfdf5",
          border: "#a7f3d0",
        },
        error: {
          DEFAULT: "#ba1a1a",
          container: "#ffdad6",
          border: "#fecaca",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      fontSize: {
        "display-h1": ["80px", { lineHeight: "0.95", letterSpacing: "-0.04em", fontWeight: "600" }],
        "h1": ["64px", { lineHeight: "1.0", letterSpacing: "-0.03em", fontWeight: "600" }],
        "h2": ["40px", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
        "h3": ["24px", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-lg": ["17px", { lineHeight: "1.6", letterSpacing: "0em", fontWeight: "400" }],
        "body": ["15px", { lineHeight: "1.5", letterSpacing: "0em", fontWeight: "400" }],
        "label-caps": ["12px", { lineHeight: "1.0", letterSpacing: "0.05em", fontWeight: "600" }],
        "button": ["14px", { lineHeight: "1.0", letterSpacing: "0.01em", fontWeight: "500" }],
      },
      borderRadius: {
        card: "24px",
        panel: "16px",
        control: "8px",
      },
      spacing: {
        section: "130px",
      },
    },
  },
  plugins: [],
}
