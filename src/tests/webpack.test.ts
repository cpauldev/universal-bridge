import { describe, expect, it } from "bun:test";

import { withUniversalWebpackDevServer } from "../adapters/build/webpack.js";
import { createSetupMiddlewaresDevServerFixture } from "./utils/adapter-server-fixtures.js";

describe("webpack adapter", () => {
  it("injects bridge wiring while preserving existing setupMiddlewares", async () => {
    const fixture = createSetupMiddlewaresDevServerFixture();
    let originalCalled = false;

    const wrapped = withUniversalWebpackDevServer(
      {
        setupMiddlewares: (middlewares: string[]) => {
          originalCalled = true;
          return [...middlewares, "original"];
        },
      },
      { autoStart: false },
    );

    const result = wrapped.setupMiddlewares?.(
      ["base"],
      fixture.devServer as never,
    );

    expect(originalCalled).toBe(true);
    expect(result).toEqual(["base", "original"]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.getSetupMiddlewareCount()).toBe(1);
    expect(fixture.getListenerCount("upgrade")).toBe(1);
    expect(fixture.getListenerCount("close")).toBe(1);

    fixture.emit("close");
  });

  it("no-ops gracefully when app is unavailable", () => {
    const wrapped = withUniversalWebpackDevServer({}, { autoStart: false });
    const middlewares = ["base"];
    const result =
      wrapped.setupMiddlewares?.(middlewares, {} as never) ?? middlewares;

    expect(result).toBe(middlewares);
  });
});
