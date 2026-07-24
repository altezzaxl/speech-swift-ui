import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { engines } from "../engines.mjs";

let serverProcess;
let baseURL;

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Studio server did not start")), 10_000);
    const onData = (chunk) => {
      if (!chunk.toString().includes("Speech Studio:")) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve();
    };
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`Studio server exited with code ${code}`)));
    child.stdout.on("data", onData);
  });
}

before(async () => {
  const port = await reservePort();
  baseURL = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      SPEECH_STUDIO_PORT: String(port),
      SPEECH_STUDIO_NO_OPEN: "1",
      SPEECH_SWIFT_BIN: process.execPath,
      SPEECH_OMNI_BIN: process.execPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(serverProcess);
});

after(() => {
  serverProcess?.kill("SIGTERM");
});

test("engine schema uses unique IDs and complete controls", () => {
  assert.equal(engines.length, 14);
  assert.equal(new Set(engines.map((engine) => engine.id)).size, engines.length);
  for (const engine of engines) {
    assert.ok(engine.name, `${engine.id} needs a name`);
    assert.ok(engine.command, `${engine.id} needs a command`);
    assert.ok(engine.fields.length > 0, `${engine.id} needs fields`);
    assert.equal(new Set(engine.fields.map((field) => field.key)).size, engine.fields.length, `${engine.id} field keys must be unique`);
    for (const field of engine.fields) {
      assert.ok(field.cli?.startsWith("--"), `${engine.id}.${field.key} needs a CLI flag`);
    }
  }
});

test("server exposes the studio and runtime configuration", async () => {
  const pageResponse = await fetch(`${baseURL}/`);
  assert.equal(pageResponse.status, 200);
  assert.match(pageResponse.headers.get("content-type"), /^text\/html/);
  assert.match(await pageResponse.text(), /Speech Studio/);

  const configResponse = await fetch(`${baseURL}/api/config`);
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.engines.length, engines.length);
  assert.equal(config.system.speechReady, true);
  assert.equal(config.system.omniReady, true);
});

test("server rejects output overrides from raw arguments", async () => {
  const response = await fetch(`${baseURL}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      engine: "qwen3",
      text: "test",
      values: {},
      rawArgs: "--output forbidden.wav",
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Output path управляется студией и недоступен в raw arguments",
  });
});

test("static file traversal is rejected", async () => {
  const response = await fetch(`${baseURL}/../package.json`);
  assert.equal(response.status, 404);
});
