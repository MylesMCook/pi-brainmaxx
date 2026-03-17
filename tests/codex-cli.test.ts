import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = path.join(packageRoot, "scripts", "brainerd-codex.sh");

test("brainerd-codex help exits cleanly", async () => {
  const { stdout, stderr } = await execFileAsync(wrapperPath, ["--help"], {
    cwd: packageRoot,
  });

  assert.match(stdout, /Usage:/);
  assert.match(stdout, /scripts\/brainerd-codex\.sh help/);
  assert.equal(stderr, "");
});

test("brainerd-codex reports unsupported commands clearly", async () => {
  await assert.rejects(
    execFileAsync(wrapperPath, ["nope"], {
      cwd: packageRoot,
    }),
    (error: NodeJS.ErrnoException & { stdout?: string; stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr ?? "", /Unsupported command: nope/);
      assert.match(error.stderr ?? "", /Usage:/);
      return true;
    },
  );
});
