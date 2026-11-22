/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#0C1F17",
        night: "#07140E",
        muted: "#5C6F65",
        canvas: "#EDF3EE",
        panel: "#FFFFFF",
        brand: "#0F7B45",
        aqua: "#17995A",
        mint: "#6BE892",
        mintsoft: "#DDF6E4",
        line: "#DBE5DE",
        success: "#0F7B45",
        warning: "#A15C00",
        danger: "#C2364A",
        teal: { 50: "#EAF6EE", 100: "#D6EFDD", 200: "#B4E2C2" }
      },
      fontFamily: {
        sans: ["Onest", "System"]
      },
      boxShadow: {
        panel: "0 14px 36px rgba(12, 31, 23, 0.07)",
        float: "0 18px 44px rgba(12, 31, 23, 0.18)"
      }
    }
  },
  plugins: []
};
