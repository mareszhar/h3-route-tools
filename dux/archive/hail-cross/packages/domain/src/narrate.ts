/* Tiny dependency-free pretty-printer for the client "shopping trip" demos. */

const c = {
  dim: (s: string) => `\x1B[2m${s}\x1B[0m`,
  bold: (s: string) => `\x1B[1m${s}\x1B[0m`,
  green: (s: string) => `\x1B[32m${s}\x1B[0m`,
  red: (s: string) => `\x1B[31m${s}\x1B[0m`,
  cyan: (s: string) => `\x1B[36m${s}\x1B[0m`,
  yellow: (s: string) => `\x1B[33m${s}\x1B[0m`,
};

export const narrate = {
  banner(title: string) {
    console.log(`\n${c.bold(c.cyan(`🍊 ${title}`))}\n${c.dim("─".repeat(title.length + 3))}`);
  },
  step(label: string) {
    console.log(`\n${c.bold(`▶ ${label}`)}`);
  },
  ok(message: string, data?: unknown) {
    console.log(`  ${c.green("✓")} ${message}${data === undefined ? "" : c.dim(` ${fmt(data)}`)}`);
  },
  info(message: string) {
    console.log(`  ${c.dim("·")} ${c.dim(message)}`);
  },
  expected(message: string, data?: unknown) {
    console.log(`  ${c.yellow("⚠")} ${message}${data === undefined ? "" : c.dim(` ${fmt(data)}`)}`);
  },
  fail(message: string, data?: unknown) {
    console.log(`  ${c.red("✗")} ${message}${data === undefined ? "" : c.dim(` ${fmt(data)}`)}`);
  },
  done(message: string) {
    console.log(`\n${c.green(c.bold(`✅ ${message}`))}\n`);
  },
};

function fmt(data: unknown): string {
  const json = JSON.stringify(data);
  return json.length > 140 ? `${json.slice(0, 137)}…` : json;
}
