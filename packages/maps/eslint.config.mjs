import base from "@retry/config/eslint";

export default [
  ...base,
  {
    // The art and map scripts are command-line tools: their output IS the
    // product ("36 tiles, 6x6 grid", "2 map(s) valid"). Hard Rule 10 is about
    // production code, and none of this ships to a browser or a server.
    files: ["scripts/**/*.ts", "authoring/**/*.ts"],
    rules: { "no-console": "off" },
  },
];
