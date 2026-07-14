import {
  Cable,
  Cpu,
  File,
  FolderOpen,
  LoaderCircle,
  type LucideIcon,
  SlidersHorizontal,
  Square,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import * as React from "react";

import { OVERLAY_POSITIONS, TABS } from "./constants.js";
import { FilesPane, WorkspaceSidebar } from "./files-pane.js";
import { RuntimePane } from "./runtime-pane.js";
import type {
  OverlayAction,
  OverlaySettings,
  OverlaySeverity,
  OverlayState,
  OverlayTab,
  OverlayTheme,
  TabDefinition,
} from "./types.js";
import { ScrollArea } from "./ui/scroll-area.js";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar.js";
import { cn } from "./ui/utils.js";

// ── Status helpers ────────────────────────────────────────────────────────────

export function resolveOverlaySeverity(state: OverlayState): OverlaySeverity {
  const phase = state.bridgeState?.runtime.phase;
  if (state.transportState === "degraded" || phase === "error") return "error";
  if (
    state.transportState === "bridge_detecting" ||
    state.transportState === "runtime_starting" ||
    state.loadingAction ||
    phase === "starting" ||
    phase === "stopping"
  ) {
    return "warning";
  }
  if (state.transportState === "connected" && phase === "running") {
    return "success";
  }
  return "info";
}

// ─────────────────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<string, LucideIcon> = {
  cpu: Cpu,
  "folder-open": FolderOpen,
  "sliders-horizontal": SlidersHorizontal,
};

export function normalizeTheme(theme: OverlayTheme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return "dark";
}

function formatPositionLabel(value: string): string {
  return value
    .split("-")
    .map((part) => (part[0]?.toUpperCase() ?? "") + part.slice(1))
    .join(" ");
}

export function BridgeStatusIcon({
  severity,
  phase,
  className,
}: {
  severity: OverlaySeverity;
  phase?: string;
  className?: string;
}) {
  const Icon =
    severity === "error"
      ? TriangleAlert
      : severity === "loading" || severity === "warning"
        ? LoaderCircle
        : phase === "stopped"
          ? Square
          : severity === "success"
            ? Cable
            : Waypoints;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3.5",
        (severity === "loading" || severity === "warning") && "animate-spin",
        className,
      )}
    />
  );
}

function TabIcon({ name }: { name: string }) {
  const Icon = TAB_ICONS[name] ?? File;
  return <Icon aria-hidden="true" />;
}

interface TabButtonProps {
  tab: TabDefinition;
  isActive: boolean;
  mode: "sidebar" | "toolbar";
  onSelect: (tab: OverlayTab) => void;
}

function TabButton({ tab, isActive, mode, onSelect }: TabButtonProps) {
  const id =
    mode === "sidebar"
      ? `overlay-tab-${tab.id}`
      : `overlay-tab-${tab.id}-toolbar`;
  const tabIndex = TABS.findIndex((candidate) => candidate.id === tab.id);

  const focusTabByIndex = (nextIndex: number) => {
    const nextTab = TABS[nextIndex];
    if (!nextTab) return;

    onSelect(nextTab.id as OverlayTab);

    const nextId =
      mode === "sidebar"
        ? `overlay-tab-${nextTab.id}`
        : `overlay-tab-${nextTab.id}-toolbar`;

    requestAnimationFrame(() => {
      document.getElementById(nextId)?.focus();
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const isVertical = mode === "sidebar";
    const lastIndex = TABS.length - 1;

    switch (event.key) {
      case "ArrowDown":
        if (!isVertical) return;
        event.preventDefault();
        focusTabByIndex(tabIndex === lastIndex ? 0 : tabIndex + 1);
        return;
      case "ArrowUp":
        if (!isVertical) return;
        event.preventDefault();
        focusTabByIndex(tabIndex === 0 ? lastIndex : tabIndex - 1);
        return;
      case "ArrowRight":
        if (isVertical) return;
        event.preventDefault();
        focusTabByIndex(tabIndex === lastIndex ? 0 : tabIndex + 1);
        return;
      case "ArrowLeft":
        if (isVertical) return;
        event.preventDefault();
        focusTabByIndex(tabIndex === 0 ? lastIndex : tabIndex - 1);
        return;
      case "Home":
        event.preventDefault();
        focusTabByIndex(0);
        return;
      case "End":
        event.preventDefault();
        focusTabByIndex(lastIndex);
        return;
      default:
        return;
    }
  };

  return (
    <SidebarMenuButton
      id={id}
      role="tab"
      aria-selected={isActive}
      aria-controls="overlay-panel"
      tabIndex={0}
      className={cn("min-w-0", mode === "toolbar" && "px-2")}
      isActive={isActive}
      onClick={() => onSelect(tab.id as OverlayTab)}
      onKeyDown={handleKeyDown}
      {...(mode === "toolbar" ? { "aria-label": tab.label } : {})}
    >
      <TabIcon name={tab.icon} />
      {mode === "sidebar" && <span>{tab.label}</span>}
    </SidebarMenuButton>
  );
}

function Topbar() {
  return (
    <div className="overlay-header">
      <div className="overlay-header-title">
        <span className="overlay-header-label">Universal Overlay</span>
      </div>
    </div>
  );
}

function Toolbar({
  activeTab,
  onSelectTab,
}: {
  activeTab: OverlayTab;
  onSelectTab: (tab: OverlayTab) => void;
}) {
  return (
    <SidebarMenu
      className="overlay-toolbar"
      role="tablist"
      aria-label="Universal Overlay tabs"
      aria-orientation="horizontal"
    >
      {TABS.map((tab) => (
        <SidebarMenuItem key={tab.id} className="shrink-0">
          <TabButton
            tab={tab}
            isActive={activeTab === tab.id}
            mode="toolbar"
            onSelect={onSelectTab}
          />
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function SidebarNav({
  activeTab,
  onSelectTab,
}: {
  activeTab: OverlayTab;
  onSelectTab: (tab: OverlayTab) => void;
}) {
  return (
    <aside className="overlay-sidebar">
      <ScrollArea className="overlay-sidebar-scroll">
        <SidebarMenu
          className="overlay-nav-tabs"
          aria-label="Universal Overlay tabs"
          role="tablist"
          aria-orientation="vertical"
        >
          {TABS.map((tab) => (
            <SidebarMenuItem key={tab.id}>
              <TabButton
                tab={tab}
                isActive={activeTab === tab.id}
                mode="sidebar"
                onSelect={onSelectTab}
              />
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </ScrollArea>
    </aside>
  );
}

interface SettingsPaneProps {
  state: OverlayState;
  onDispatch: (action: OverlayAction) => void;
}

function SettingsPane({ state, onDispatch }: SettingsPaneProps) {
  const settings = state.settings;

  const applySettings = (next: OverlaySettings) =>
    onDispatch({ type: "setSettings", settings: next });

  return (
    <section className="overlay-pane">
      <section className="overlay-section">
        <h4 className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Appearance
        </h4>
        <div className="overlay-settings-row">
          <label className="text-sm leading-[1.35]">Theme</label>
          <Select
            value={settings.theme}
            onValueChange={(value) =>
              value &&
              applySettings({
                ...settings,
                theme: value as OverlaySettings["theme"],
              })
            }
          >
            <SelectTrigger className="w-auto">
              <SelectValue>
                {(settings.theme[0]?.toUpperCase() ?? "") +
                  settings.theme.slice(1)}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {(["system", "light", "dark"] as const).map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {(opt[0]?.toUpperCase() ?? "") + opt.slice(1)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="overlay-settings-row">
          <label className="text-sm leading-[1.35]">Position</label>
          <Select
            value={settings.position}
            onValueChange={(value) =>
              value &&
              applySettings({
                ...settings,
                position: value as OverlaySettings["position"],
              })
            }
          >
            <SelectTrigger className="w-auto">
              <SelectValue>
                {formatPositionLabel(settings.position)}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {OVERLAY_POSITIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {formatPositionLabel(opt)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </section>
    </section>
  );
}

export interface OverlayPanelProps {
  state: OverlayState;
  runtimeSnapshot: import("universal-bridge").BridgeRuntimeSnapshot;
  onDispatch: (action: OverlayAction) => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onLoadFileMetadata: (path: string) => void;
  onOpenFile: (path: string) => void;
  onEnsureFileTreeLoaded: () => void;
}

export function OverlayPanel({
  state,
  runtimeSnapshot,
  onDispatch,
  onStart,
  onStop,
  onRestart,
  onLoadFileMetadata,
  onOpenFile,
  onEnsureFileTreeLoaded,
}: OverlayPanelProps) {
  const theme = normalizeTheme(state.settings.theme);
  const severity = resolveOverlaySeverity(state);
  const useWorkspaceSidebar = state.activeTab === "files";

  const selectTab = (tab: OverlayTab) => {
    onDispatch({ type: "setTab", tab });
    if (tab === "files") onEnsureFileTreeLoaded();
  };

  const renderActivePane = () => {
    switch (state.activeTab) {
      case "runtime":
        return (
          <RuntimePane
            state={state}
            runtimeSnapshot={runtimeSnapshot}
            onStart={onStart}
            onStop={onStop}
            onRestart={onRestart}
          />
        );
      case "files":
        return <FilesPane state={state} onOpenFile={onOpenFile} />;
      case "settings":
        return <SettingsPane state={state} onDispatch={onDispatch} />;
      default:
        return null;
    }
  };

  return (
    <div
      className="overlay-shell overlay-root"
      data-role="overlay-shell"
      data-theme={theme}
      data-severity={severity}
      {...(useWorkspaceSidebar ? { "data-workspace-sidebar": "true" } : {})}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Topbar />
      <Toolbar activeTab={state.activeTab} onSelectTab={selectTab} />
      <div className="overlay-layout" data-role="overlay-layout">
        {useWorkspaceSidebar ? (
          <WorkspaceSidebar
            state={state}
            onDispatch={onDispatch}
            onLoadFileMetadata={onLoadFileMetadata}
          />
        ) : (
          <SidebarNav activeTab={state.activeTab} onSelectTab={selectTab} />
        )}
        <section className="overlay-main" data-role="overlay-main">
          <ScrollArea
            key={state.activeTab}
            className="overlay-body"
            id="overlay-panel"
            role="tabpanel"
          >
            {renderActivePane()}
          </ScrollArea>
        </section>
      </div>
    </div>
  );
}
