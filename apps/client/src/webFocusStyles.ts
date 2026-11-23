import { Platform } from "react-native";

/**
 * Web only: text fields show focus on their own rounded border instead of a
 * square outline drawn outside it. This lives here rather than in global.css
 * because NativeWind's native CSS parser cannot handle these input selectors.
 */
if (Platform.OS === "web" && typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
input:focus-visible,
textarea:focus-visible {
  outline: none;
  border-color: #0f7b45 !important;
  box-shadow: 0 0 0 3px rgba(15, 123, 69, 0.18);
}
`;
  document.head.appendChild(style);
}
