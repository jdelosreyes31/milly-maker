/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    rules: {
      "no-console": "warn",
      "prefer-const": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
