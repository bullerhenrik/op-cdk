import { defineConfig } from "vitest/config"

export default defineConfig({
  languageOptions: {
    parser: "@typescript-eslint/parser",
    parserOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
    },
  },
  plugins: {
    "@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
    import: require("eslint-plugin-import"),
  },
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "import/no-unresolved": "error",
    "prettier/prettier": "error",
  },
  settings: {
    "import/resolver": {
      typescript: {},
    },
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      rules: {
        "eslint:recommended": "error",
        "@typescript-eslint/recommended": "error",
        "plugin:import/errors": "error",
        "plugin:import/warnings": "error",
        "plugin:import/typescript": "error",
        prettier: "error",
      },
    },
  ],
})
