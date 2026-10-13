import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { rules: { "@next/next/no-img-element": "off", "@next/next/no-page-custom-font": "off" } },
  { ignores: [".next/**", "programs/**", "node_modules/**", "e2e/**", "playwright-report/**"] },
];
