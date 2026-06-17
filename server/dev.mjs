import { spawn } from "node:child_process";

const children = [
  spawn("node", ["server/index.mjs"], { stdio: "inherit" }),
  spawn("npx", ["vite", "--host", "127.0.0.1"], { stdio: "inherit" }),
];

function shutdown(signal) {
  for (const child of children) {
    child.kill(signal);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

