/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        monad: {
          purple: "#836EF9",
          dark: "#0F111A",
          card: "#181A26",
          border: "#2A2D3D"
        }
      }
    },
  },
  plugins: [],
}
