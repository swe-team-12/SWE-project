import { localeBundles } from "@/locales";

function keys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}

describe("area locale bundles", () => {
  it("define the same keys in English, Russian and Kazakh", () => {
    for (const bundle of localeBundles) {
      expect(keys(bundle.ru)).toEqual(keys(bundle.en));
      expect(keys(bundle.kk)).toEqual(keys(bundle.en));
    }
  });
});
