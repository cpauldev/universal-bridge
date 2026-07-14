import { ArrowUpRight, Play, RotateCcw, Square } from "lucide-react";
import * as React from "react";
import {
  type BridgeRuntimeSnapshot,
  createUniversalClient,
} from "universal-bridge";

import {
  type DashboardActionId,
  type DashboardActionState,
  type DashboardControlsSection,
  type DashboardLiveState,
  type DashboardTableCell,
  type DashboardTableSection,
  type DashboardTransportState,
  type RuntimeWebSocketDemoController,
  type RuntimeWebSocketDemoState,
  buildRuntimeSections,
  createRuntimeWebSocketDemoController,
} from "../dashboard/index.js";
import { OVERLAY_RUNTIME_FALLBACK_COMMAND } from "../overlay-config.js";
import { BRIDGE_BASE_PATH } from "./constants.js";
import type { OverlayState } from "./types.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { cn } from "./ui/utils.js";

type KvBadgeVariant =
  "success" | "error" | "warning" | "secondary" | "default" | "info";

function resolveDashboardActionLoading(
  loadingAction: string | null,
): DashboardActionId | null {
  if (loadingAction === "Starting") return "start";
  if (loadingAction === "Restarting") return "restart";
  if (loadingAction === "Stopping") return "stop";
  return null;
}

function toDashboardLiveState(state: OverlayState): DashboardLiveState {
  return {
    hasBootstrapped: state.hasBootstrapped,
    connected: state.connected,
    transportState: state.transportState as DashboardTransportState,
    bridgeState: state.bridgeState,
    errorMessage: state.errorMessage,
    lastUpdatedAt: state.lastSuccessAt,
    consecutiveFailures: 0,
    fallbackCommand:
      state.bridgeState?.capabilities?.fallbackCommand ??
      OVERLAY_RUNTIME_FALLBACK_COMMAND,
    protocolVersion: state.bridgeState?.protocolVersion ?? null,
  };
}

function resolveToneClassName(
  tone: "default" | "muted" | "code" | undefined,
): string {
  if (tone === "muted") {
    return "break-words text-muted-foreground";
  }
  if (tone === "code") {
    return "break-words font-mono text-[11px]";
  }
  return "break-words";
}

function toKvRowValueProps(value: DashboardTableCell): {
  value: string;
  badgeVariant?: KvBadgeVariant;
  href?: string;
  tone?: "default" | "muted" | "code";
} {
  if (value.kind === "badge") {
    return { value: value.text, badgeVariant: value.variant };
  }

  if (value.kind === "link") {
    return {
      value: value.text,
      href: value.href,
      tone: value.tone,
    };
  }

  return {
    value: value.text,
    tone: value.tone,
  };
}

function KvRow({
  label,
  value,
  badgeVariant,
  href,
  tone,
  children,
}: {
  label: string;
  value: string;
  badgeVariant?: KvBadgeVariant;
  href?: string;
  tone?: "default" | "muted" | "code";
  children?: React.ReactNode;
}) {
  return (
    <div className="overlay-kv-row text-xs leading-[1.35]">
      <span className="text-muted-foreground">{label}</span>
      {children ??
        (badgeVariant !== undefined ? (
          <Badge
            variant={badgeVariant}
            size="sm"
            className="justify-self-start"
          >
            {value || "n/a"}
          </Badge>
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(
              "inline-flex min-w-0 items-center gap-1 text-primary hover:underline",
              resolveToneClassName(tone),
            )}
          >
            {value || "n/a"}
            <ArrowUpRight aria-hidden="true" size={12} />
          </a>
        ) : (
          <span className={resolveToneClassName(tone)}>{value || "n/a"}</span>
        ))}
    </div>
  );
}

function resolveRuntimeActionHandler(
  action: DashboardActionState,
  handlers: {
    onStart: () => void;
    onStop: () => void;
    onRestart: () => void;
  },
): () => void {
  if (action.id === "start") return handlers.onStart;
  if (action.id === "restart") return handlers.onRestart;
  return handlers.onStop;
}

function RuntimeActionIcon({ actionId }: { actionId: DashboardActionId }) {
  if (actionId === "start") {
    return <Play aria-hidden="true" size={14} />;
  }
  if (actionId === "restart") {
    return <RotateCcw aria-hidden="true" size={14} />;
  }
  return <Square aria-hidden="true" size={14} />;
}

function RuntimeWebSocketDemo({ enabled }: { enabled: boolean }) {
  const controllerRef = React.useRef<RuntimeWebSocketDemoController | null>(
    null,
  );
  const [demoState, setDemoState] = React.useState<RuntimeWebSocketDemoState>({
    connection: enabled ? "connecting" : "closed",
    connectionLabel: enabled ? "Connecting" : "Closed",
    message: "No message sent",
    pending: false,
  });

  React.useEffect(() => {
    if (!enabled) {
      setDemoState({
        connection: "closed",
        connectionLabel: "Closed",
        message: "No message sent",
        pending: false,
      });
      return;
    }

    const client = createUniversalClient({
      bridgePathPrefix: BRIDGE_BASE_PATH,
    });
    const controller = createRuntimeWebSocketDemoController({
      url: client.getRuntimeWebSocketUrl(),
      onState: setDemoState,
    });
    controllerRef.current = controller;
    return () => {
      controller.close();
      controllerRef.current = null;
    };
  }, [enabled]);

  return (
    <div className="overlay-kv-grid">
      <KvRow label="Demo socket" value={demoState.connectionLabel} />
      <KvRow label="Demo delay" value="">
        <span className="flex flex-wrap gap-1.5">
          {([1, 2, 3] as const).map((seconds) => (
            <Button
              key={seconds}
              disabled={demoState.connection !== "live" || demoState.pending}
              onClick={() => controllerRef.current?.sendDelay(seconds)}
              size="sm"
              variant="outline"
            >
              {seconds}s
            </Button>
          ))}
        </span>
      </KvRow>
      <KvRow label="Demo message" value={demoState.message} />
    </div>
  );
}

export interface RuntimePaneProps {
  state: OverlayState;
  runtimeSnapshot: BridgeRuntimeSnapshot;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
}

export function RuntimePane({
  state,
  runtimeSnapshot,
  onStart,
  onStop,
  onRestart,
}: RuntimePaneProps) {
  const runtimeData = buildRuntimeSections({
    live: toDashboardLiveState(state),
    runtimeSnapshot,
    actionLoading: resolveDashboardActionLoading(state.loadingAction),
  });

  const controlsSection = runtimeData.sections.find(
    (section): section is DashboardControlsSection => section.id === "controls",
  );
  const runtimeSections = runtimeData.sections.filter(
    (section): section is DashboardTableSection => section.id !== "controls",
  );

  return (
    <div className="overlay-pane">
      <div className="overlay-section">
        <h4 className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Controls
        </h4>
        <div className="overlay-actions">
          {(controlsSection?.actions ?? []).map((action) => (
            <Button
              key={action.id}
              variant={
                action.disabled || action.loading ? "secondary" : "outline"
              }
              disabled={action.disabled}
              onClick={resolveRuntimeActionHandler(action, {
                onStart,
                onStop,
                onRestart,
              })}
            >
              <RuntimeActionIcon actionId={action.id} />
              {action.loading ? action.loadingLabel : action.label}
            </Button>
          ))}
        </div>
        {controlsSection?.message && (
          <p className="text-xs leading-[1.4] text-muted-foreground">
            {controlsSection.message}
          </p>
        )}
      </div>

      <div className="overlay-runtime-columns">
        {runtimeSections.map((section) => (
          <div key={section.id} className="overlay-runtime-column">
            <div className="overlay-runtime-section-heading">
              <h4 className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                {section.title}
              </h4>
              {section.description && (
                <p className="text-xs leading-[1.35] text-muted-foreground">
                  {section.description}
                </p>
              )}
            </div>
            {section.id === "runtime-websocket" ? (
              <>
                <div className="overlay-kv-grid">
                  {section.rows.map((row) => (
                    <KvRow
                      key={row.key}
                      label={row.label}
                      {...toKvRowValueProps(row.value)}
                    />
                  ))}
                </div>
                <RuntimeWebSocketDemo
                  enabled={Boolean(
                    state.bridgeState?.capabilities.hasRuntimeWebSocketGateway,
                  )}
                  key={
                    state.bridgeState?.runtime.startedAt ??
                    "runtime-not-started"
                  }
                />
              </>
            ) : (
              <div className="overlay-kv-grid">
                {section.rows.map((row) => (
                  <KvRow
                    key={row.key}
                    label={row.label}
                    {...toKvRowValueProps(row.value)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
