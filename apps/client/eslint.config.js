const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  {
    ignores: ["dist/**", ".expo/**"],
  },
  expoConfig,
  {
    rules: {
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
