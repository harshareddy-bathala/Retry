import base from "@retry/config/eslint";

export default [
  ...base,
  {
    // The load script is a command-line measurement tool whose entire output
    // is numbers on stdout. Hard Rule 10 bans console in PRODUCTION code —
    // where a log line belongs to the logger and an error to Sentry — and
    // routing "p95 67.8ms" through a structured logger would make it harder to
    // read for no benefit. Scoped to this one file rather than the package, so
    // a stray console.log in a spec still fails the lint.
    files: ["load/**/*.ts"],
    rules: { "no-console": "off" },
  },
];
