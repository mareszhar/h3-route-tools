import antfu from "@antfu/eslint-config";

export default antfu(
  {
    formatters: true,
    typescript: true,
    ignores: ["dist/**", "node_modules/**", ".nitro/**", ".output/**", ".turbo/**"],
  },
  {
    files: ["**/*.md"],
    rules: {
      "format/prettier": "off",
    },
  },
  {
    // These are runnable Bun/Node servers and CLI demo scripts: console output
    // (request logs, narration), top-level await and the global `process` are
    // all intentional here.
    rules: {
      "antfu/no-top-level-await": "off",
      "no-console": "off",
      "node/prefer-global/process": "off",
    },
  }
);
