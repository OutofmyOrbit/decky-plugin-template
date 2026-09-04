import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const commands = process.platform === "win32"
  ? [
      ["ruff", args],
      ["py", ["-m", "ruff", ...args]],
      ["python", ["-m", "ruff", ...args]],
    ]
  : [
      ["ruff", args],
      ["python3", ["-m", "ruff", ...args]],
      ["python", ["-m", "ruff", ...args]],
    ];

for (const [command, commandArgs] of commands) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (!result.error) {
    process.exit(result.status ?? 1);
  }
}

console.error("Ruff is not installed. Install it with: python -m pip install ruff");
process.exit(1);