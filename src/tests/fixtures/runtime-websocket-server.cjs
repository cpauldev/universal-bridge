const { createServer } = require("http");
const { WebSocketServer } = require("ws");

const port = Number(process.env.UNIVERSAL_RUNTIME_PORT);
const server = createServer((request, response) => {
  if (request.url === "/api/version") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) =>
    protocols.has("runtime.v1") ? "runtime.v1" : false,
});

server.on("upgrade", (request, socket, head) => {
  if (!request.url.startsWith("/socket")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit("connection", webSocket, request);
  });
});

wss.on("connection", (socket, request) => {
  socket.send(
    JSON.stringify({ type: "ready", query: request.url.split("?")[1] || "" }),
  );
  socket.on("message", (data, isBinary) => {
    if (!isBinary && data.toString() === "close-now") {
      socket.close(1000, "runtime complete");
      return;
    }
    if (!isBinary && data.toString() === "terminate-now") {
      socket.terminate();
      return;
    }
    socket.send(data, { binary: isBinary });
  });
});

server.listen(port, "127.0.0.1");
