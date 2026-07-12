const http = require("http");

const host = "127.0.0.1";
const port = Number(process.env.UNIVERSAL_RUNTIME_PORT || 0);

if (!port || Number.isNaN(port)) {
  throw new Error("UNIVERSAL_RUNTIME_PORT is required");
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || "GET";
  const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = parsedUrl.pathname;

  if (method === "GET" && pathname === "/api/version") {
    writeJson(res, 200, { ok: true, runtime: "e2e" });
    return;
  }

  if (method === "GET" && pathname === "/api/pid") {
    writeJson(res, 200, { pid: process.pid });
    return;
  }

  if (method === "POST" && pathname === "/api/echo") {
    const body = await readBody(req);
    writeJson(res, 200, { method, body });
    return;
  }

  if (method === "POST" && pathname === "/api/echo-binary") {
    const body = await readBodyBuffer(req);
    writeJson(res, 200, { bodyHex: body.toString("hex") });
    return;
  }

  if (method === "GET" && pathname === "/api/cookies") {
    res.setHeader("Set-Cookie", [
      "session=abc; Path=/; HttpOnly",
      "theme=dark; Path=/",
    ]);
    writeJson(res, 200, { ok: true });
    return;
  }

  writeJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(port, host);

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
