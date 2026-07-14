import { mountExampleDashboard } from "@example/shared/dashboard-client";
import { useEffect, useRef } from "react";

export default function Home() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      throw new Error("Missing dashboard root");
    }

    const cleanup = mountExampleDashboard({
      root,
      frameworkId: "react-router",
    });

    return () => {
      cleanup();
    };
  }, []);

  return <div ref={rootRef} />;
}
