/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0f1a17",
          900: "#15241f",
          800: "#1e332c",
          700: "#2a463c",
          600: "#3a5c4f",
        },
        moss: {
          500: "#3f7a5c",
          400: "#5a9a75",
          300: "#8fbfa3",
        },
        sand: {
          50: "#f7f3eb",
          100: "#efe6d6",
          200: "#e2d3b8",
        },
        coral: {
          500: "#c45c3a",
          400: "#d97855",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "app-glow":
          "radial-gradient(1200px 600px at 10% -10%, rgba(90,154,117,0.28), transparent 55%), radial-gradient(900px 500px at 100% 0%, rgba(196,92,58,0.14), transparent 50%), linear-gradient(165deg, #f7f3eb 0%, #e8f0ea 45%, #f3ebe2 100%)",
      },
      boxShadow: {
        soft: "0 10px 30px rgba(15, 26, 23, 0.08)",
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
