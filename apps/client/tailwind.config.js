/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        ink: "#102A43",
        muted: "#627D98",
        canvas: "#F4F8FB",
        panel: "#FFFFFF",
        brand: "#007C83",
        aqua: "#00A7A5",
        line: "#D9E2EC",
        success: "#16865C",
        warning: "#B76E00",
        danger: "#C43D4B"
      },
      fontFamily: {
        sans: ["System"]
      },
      boxShadow: {
        panel: "0 12px 32px rgba(16, 42, 67, 0.08)"
      }
    }
  },
  plugins: []
};
