/** @type {import('tailwindcss').Config} */

// Palette values live as CSS variables (see globals.css) so the whole app can
// switch between light and dark without per-component class changes.
const themed = (name) => ({
  50: `rgb(var(--c-${name}-50) / <alpha-value>)`,
  100: `rgb(var(--c-${name}-100) / <alpha-value>)`,
  200: `rgb(var(--c-${name}-200) / <alpha-value>)`,
  300: `rgb(var(--c-${name}-300) / <alpha-value>)`,
  400: `rgb(var(--c-${name}-400) / <alpha-value>)`,
  500: `rgb(var(--c-${name}-500) / <alpha-value>)`,
  600: `rgb(var(--c-${name}-600) / <alpha-value>)`,
  700: `rgb(var(--c-${name}-700) / <alpha-value>)`,
  800: `rgb(var(--c-${name}-800) / <alpha-value>)`,
  900: `rgb(var(--c-${name}-900) / <alpha-value>)`,
  950: `rgb(var(--c-${name}-950) / <alpha-value>)`,
});

module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ink: themed("ink"),
        moss: themed("moss"),
        sand: themed("sand"),
        coral: themed("coral"),
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "app-glow": "var(--app-glow)",
      },
      boxShadow: {
        soft: "var(--shadow-soft)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        drift: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        rise: "rise 0.55s ease-out both",
        "rise-delay": "rise 0.7s ease-out 0.08s both",
        drift: "drift 6s ease-in-out infinite",
        shimmer: "shimmer 8s linear infinite",
      },
    },
  },
  plugins: [],
};
