const assert = require("node:assert/strict");

const calls = [];
global.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (options.method === "PUT") {
    return new Response(JSON.stringify({ commit: { sha: "commit-sha" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (options.headers?.Accept === "application/vnd.github.raw+json") {
    return new Response("window.BUILTIN_STITCH_PROGRESS = {};\n", { status: 200 });
  }
  return new Response(JSON.stringify({ sha: "file-sha" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

require("../src/github-sync.js");

async function run() {
  const sync = global.CrossStitchGithubSync;
  assert.ok(sync);
  assert.equal(sync.config.owner, "sven-wikberg");
  assert.equal(sync.config.repository, "Cross-Stitch-Utils");

  const utf8Sample = "Broderie \u00e9t\u00e9";
  assert.equal(sync.utf8ToBase64(utf8Sample), Buffer.from(utf8Sample, "utf8").toString("base64"));

  const loaded = await sync.loadFile("");
  assert.equal(loaded, "window.BUILTIN_STITCH_PROGRESS = {};\n");
  assert.equal(calls[0].options.cache, "no-store");

  const content = "window.BUILTIN_STITCH_PROGRESS = {\"savedAt\":\"now\"};\n";
  await sync.saveFile(content, "secret-token");
  const metadataCall = calls.find((call) => !call.options.method && call.options.headers?.Authorization);
  const putCall = calls.find((call) => call.options.method === "PUT");
  assert.equal(metadataCall.options.headers.Authorization, "Bearer secret-token");
  assert.equal(putCall.options.headers.Authorization, "Bearer secret-token");

  const body = JSON.parse(putCall.options.body);
  assert.equal(body.sha, "file-sha");
  assert.equal(body.branch, "main");
  assert.equal(Buffer.from(body.content, "base64").toString("utf8"), content);
  console.log("github sync tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
