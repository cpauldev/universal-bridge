import { describe, expect, it } from "bun:test";

import { withUniversalRsbuild } from "../adapters/build/rsbuild.js";
import { withUniversalRspack } from "../adapters/build/rspack.js";
import { createSetupMiddlewaresDevServerFixture } from "./utils/adapter-server-fixtures.js";

describe("build tool adapters", () => {
  it("withUniversalRsbuild wires setupMiddlewares", async () => {
    const fixture = createSetupMiddlewaresDevServerFixture();
    const wrapped = withUniversalRsbuild(
      {
        setupMiddlewares: (middlewares: string[]) => [
          ...middlewares,
          "rsbuild",
        ],
      },
      { autoStart: false },
    );

    const result = wrapped.setupMiddlewares?.(
      ["base"],
      fixture.devServer as never,
    );
    expect(result).toEqual(["base", "rsbuild"]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.getSetupMiddlewareCount()).toBe(1);
    expect(fixture.getListenerCount("upgrade")).toBe(1);
    expect(fixture.getListenerCount("close")).toBe(1);

    fixture.emit("close");
  });

  it("withUniversalRspack wires setupMiddlewares", async () => {
    const fixture = createSetupMiddlewaresDevServerFixture();
    const wrapped = withUniversalRspack(
      {
        setupMiddlewares: (middlewares: string[]) => [...middlewares, "rspack"],
      },
      { autoStart: false },
    );

    const result = wrapped.setupMiddlewares?.(
      ["base"],
      fixture.devServer as never,
    );
    expect(result).toEqual(["base", "rspack"]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.getSetupMiddlewareCount()).toBe(1);
    expect(fixture.getListenerCount("upgrade")).toBe(1);
    expect(fixture.getListenerCount("close")).toBe(1);

    fixture.emit("close");
  });
});
