import { resolve } from "node:path";
import { withUniversalNext } from "universal-bridge/next";

export default withUniversalNext(
  { logging: { browserToTerminal: false } },
  {
    command: process.execPath,
    args: [
      resolve(
        import.meta.dirname,
        "../../../../src/tests/fixtures/runtime-websocket-server.cjs",
      ),
    ],
    runtimeWebSocketGateway: { path: "/socket" },
    startTimeoutMs: 5_000,
  },
);
