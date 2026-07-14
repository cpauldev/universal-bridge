import {
  type DashboardActionId,
  type DashboardControllerState,
  type DashboardFrameworkId,
  type DashboardTableCell,
  createDashboardController,
  createRuntimeWebSocketDemoController,
} from "@example/universal-overlay/dashboard";
import {
  type IconNode,
  Moon,
  Play,
  RotateCcw,
  Square,
  Sun,
  createElement,
} from "lucide";

import {
  DASHBOARD_ACTION_CONTROLS,
  type DashboardRuntimeUiState,
  buildRuntimeUiState,
  createActionStateMap,
  createRuntimePanels,
  createRuntimePanelsSignature,
  resolveActionLabel,
  syncRuntimePanels,
} from "./dashboard";
import { getFrameworkVisual, viteBadgeIconSvg } from "./frameworks";
import { applyTheme, getInitialTheme, toggleTheme } from "./theme";
import {
  Button,
  createCard,
  createCardContent,
  createCardDescription,
  createCardHeader,
  createCardTitle,
  createFieldLabel,
  createTableCell,
  createTableRow,
} from "./ui";

const ACTION_ICONS: Record<DashboardActionId, IconNode> = {
  start: Play,
  stop: Square,
  restart: RotateCcw,
};

const THEME_ICONS: Record<"dark" | "light", IconNode> = {
  dark: Sun,
  light: Moon,
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createLucideIcon(
  icon: IconNode,
  size: number,
  className: string,
): SVGElement {
  return createElement(icon, {
    width: size,
    height: size,
    class: className,
    "aria-hidden": "true",
    focusable: "false",
  });
}

interface DashboardShellHosts {
  runtimeCardHost: HTMLElement;
}

function setThemeIcon(button: HTMLElement, theme: "light" | "dark"): void {
  const icon = theme === "dark" ? THEME_ICONS.dark : THEME_ICONS.light;
  button.replaceChildren(createLucideIcon(icon, 20, "example-theme-icon"));
}

function renderDashboardShell(input: {
  root: HTMLElement;
  theme: "light" | "dark";
  frameworkId: DashboardFrameworkId;
}): DashboardShellHosts {
  input.root.className = "example-page";
  input.root.setAttribute("data-theme", input.theme);
  input.root.innerHTML = `
    <div class="example-container">
      <div class="example-dashboard-grid">
        <div class="example-column">
          <div data-runtime-card-host="true"></div>
        </div>
      </div>
    </div>
  `;

  const runtimeCardHost = input.root.querySelector<HTMLElement>(
    "[data-runtime-card-host='true']",
  );
  if (!runtimeCardHost) {
    throw new Error("Failed to initialize dashboard shell");
  }

  return {
    runtimeCardHost,
  };
}

interface ActionButtonRefs {
  button: HTMLButtonElement;
  label: HTMLSpanElement;
}

function createActionButton(input: {
  actionId: DashboardActionId;
  initialLabel: string;
  onClick: (actionId: DashboardActionId) => void;
}): ActionButtonRefs {
  const button = new Button({
    size: "default",
    variant: "outline",
    className: "example-action-btn",
    onClick: () => {
      input.onClick(input.actionId);
    },
  }).getElement();
  button.setAttribute("data-action", input.actionId);
  button.appendChild(
    createLucideIcon(ACTION_ICONS[input.actionId], 14, "example-action-icon"),
  );

  const label = document.createElement("span");
  label.textContent = input.initialLabel;
  button.appendChild(label);
  return { button, label };
}

function applyActionState(
  refs: ActionButtonRefs,
  input: { label: string; disabled: boolean; active: boolean },
): void {
  if (refs.label.textContent !== input.label) {
    refs.label.textContent = input.label;
  }
  if (refs.button.disabled !== input.disabled) {
    refs.button.disabled = input.disabled;
  }
  if (refs.button.hidden) {
    refs.button.hidden = false;
  }
  if (refs.button.getAttribute("aria-label") !== input.label) {
    refs.button.setAttribute("aria-label", input.label);
  }
  if (refs.button.getAttribute("title") !== input.label) {
    refs.button.setAttribute("title", input.label);
  }

  const nextVariant = input.disabled || input.active ? "secondary" : "outline";
  if (refs.button.getAttribute("data-variant") !== nextVariant) {
    refs.button.setAttribute("data-variant", nextVariant);
  }

  if (input.active) {
    refs.button.setAttribute("data-pressed", "true");
    refs.button.setAttribute("aria-busy", "true");
  } else {
    refs.button.removeAttribute("data-pressed");
    refs.button.removeAttribute("aria-busy");
  }
}

interface RuntimeCardRefs {
  controlsHost: HTMLElement;
  summaryEl: HTMLElement;
  panelsHost: HTMLElement;
}

function createRuntimeCard(
  host: HTMLElement,
  frameworkId: DashboardFrameworkId,
): RuntimeCardRefs {
  const framework = getFrameworkVisual(frameworkId);
  const frameworkIconColor =
    framework.id === "astro" ||
    framework.id === "nextjs" ||
    framework.id === "react-router"
      ? "var(--card-foreground)"
      : framework.id === "react"
        ? "#06b6d4"
        : framework.pillBg;
  const viteTagHtml = framework.usesVite
    ? `<span class="example-header-icon example-vite-icon" title="Vite" aria-label="Vite">${viteBadgeIconSvg()}</span>`
    : "";
  const runtimeCard = createCard("example-runtime-card");
  const runtimeCardHeader = createCardHeader();
  runtimeCardHeader.innerHTML = `
    <div class="example-header-left">
      <div class="example-title-row">
        <div class="example-brand-block">
          <div class="example-header-icons">
            <span class="example-header-icon example-framework-icon" style="color:${frameworkIconColor}" title="${escapeHtml(framework.label)}" aria-label="${escapeHtml(framework.label)}">${framework.iconSvg}</span>
            ${viteTagHtml}
          </div>
          <h3 class="example-title">Universal Bridge</h3>
        </div>
        <div class="example-top-controls" data-runtime-controls="true"></div>
      </div>
    </div>
  `;
  const runtimeCardHeaderRow = document.createElement("div");
  runtimeCardHeaderRow.className = "example-card-header-row";
  runtimeCardHeaderRow.appendChild(createCardTitle("Status"));
  runtimeCardHeader.appendChild(runtimeCardHeaderRow);

  const summaryEl = createCardDescription("", "example-runtime-summary");
  summaryEl.setAttribute("data-runtime-summary", "true");
  runtimeCardHeader.appendChild(summaryEl);

  const runtimeCardContent = createCardContent();
  const panelsHost = document.createElement("div");
  panelsHost.className = "example-runtime-panels";
  panelsHost.setAttribute("data-runtime-panels-host", "true");
  runtimeCardContent.appendChild(panelsHost);

  runtimeCard.append(runtimeCardHeader, runtimeCardContent);
  host.appendChild(runtimeCard);
  const controlsHost = runtimeCardHeader.querySelector<HTMLElement>(
    "[data-runtime-controls='true']",
  );
  if (!controlsHost) {
    throw new Error("Failed to initialize runtime controls");
  }
  return { controlsHost, summaryEl, panelsHost };
}

function createActionControlMap(
  host: HTMLElement,
  onAction: (actionId: DashboardActionId) => void,
): ReadonlyMap<DashboardActionId, ActionButtonRefs> {
  const actionControlMap = new Map<DashboardActionId, ActionButtonRefs>();
  for (const control of DASHBOARD_ACTION_CONTROLS) {
    const refs = createActionButton({
      actionId: control.id,
      initialLabel: control.fallbackLabel,
      onClick: onAction,
    });
    actionControlMap.set(control.id, refs);
    host.appendChild(refs.button);
  }
  return actionControlMap;
}

function createThemeToggleButton(host: HTMLElement): HTMLButtonElement {
  const button = new Button({
    size: "icon",
    variant: "outline",
    className: "example-theme-toggle",
    ariaLabel: "Toggle theme",
    title: "Toggle theme",
  }).getElement();
  button.setAttribute("data-toggle-theme", "true");
  host.appendChild(button);
  return button;
}

function syncControlButtons(
  actionControlMap: ReadonlyMap<DashboardActionId, ActionButtonRefs>,
  actions: DashboardRuntimeUiState["controls"],
): void {
  const actionsById = createActionStateMap(actions);
  for (const control of DASHBOARD_ACTION_CONTROLS) {
    const refs = actionControlMap.get(control.id);
    if (!refs) {
      continue;
    }
    const action = actionsById.get(control.id) ?? null;
    applyActionState(refs, {
      label: resolveActionLabel(action, control.fallbackLabel),
      disabled: action?.disabled ?? true,
      active: action?.loading ?? false,
    });
  }
}

interface RuntimeWebSocketDemo {
  endpoint: string;
  runtimeKey: string;
  dispose: () => void;
}

function getTextCellText(cell: DashboardTableCell | undefined): string | null {
  return cell?.kind === "text" ? cell.text : null;
}

function getBadgeCellText(cell: DashboardTableCell | undefined): string | null {
  return cell?.kind === "badge" ? cell.text : null;
}

function mountRuntimeWebSocketDemo(
  panelsHost: HTMLElement,
  endpoint: string,
  runtimeKey: string,
): RuntimeWebSocketDemo | null {
  const panel = panelsHost.querySelector<HTMLElement>(
    '[data-runtime-panel="runtime-websocket"]',
  );
  const tableBody = panel?.querySelector<HTMLTableSectionElement>(
    '[data-runtime-table-body="true"]',
  );
  if (!tableBody) return null;

  const socketRow = createTableRow();
  const messageRow = createTableRow();
  const actionsRow = createTableRow();
  const createLabelCell = (label: string) => {
    const cell = createTableCell("example-status-label-cell");
    cell.appendChild(
      createFieldLabel(label, undefined, "example-status-label"),
    );
    return cell;
  };
  const socketValue = createTableCell("example-status-value-cell");
  const messageValue = createTableCell("example-status-value-cell");
  const actionsValue = createTableCell("example-status-value-cell");
  const delayActions = document.createElement("span");
  delayActions.className = "example-runtime-delay-actions";
  socketRow.append(createLabelCell("Demo socket"), socketValue);
  actionsRow.append(createLabelCell("Demo delay"), actionsValue);
  messageRow.append(createLabelCell("Demo message"), messageValue);
  tableBody.append(socketRow, actionsRow, messageRow);

  const url = new URL(endpoint, window.location.origin);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const buttons: HTMLButtonElement[] = [];
  const setSocket = (value: string) => (socketValue.textContent = value);
  const setMessage = (value: string) => (messageValue.textContent = value);
  const setButtonsDisabled = (disabled: boolean) => {
    for (const button of buttons) {
      button.disabled = disabled;
    }
  };
  const controller = createRuntimeWebSocketDemoController({
    url: url.toString(),
    onState: (state) => {
      const disabled = state.connection !== "live" || state.pending;
      setSocket(state.connectionLabel);
      setMessage(state.message);
      setButtonsDisabled(disabled);
    },
  });
  for (const seconds of [1, 2, 3] as const) {
    const button = new Button({
      size: "sm",
      variant: "outline",
      onClick: () => {
        controller.sendDelay(seconds);
      },
    }).getElement();
    button.textContent = `${seconds}s`;
    button.disabled = true;
    buttons.push(button);
    delayActions.appendChild(button);
  }
  actionsValue.appendChild(delayActions);
  return {
    endpoint,
    runtimeKey,
    dispose: () => {
      controller.close();
      socketRow.remove();
      messageRow.remove();
      actionsRow.remove();
    },
  };
}

export function mountExampleDashboard(options: {
  root: HTMLElement;
  frameworkId: DashboardFrameworkId;
}): () => void {
  const controller = createDashboardController();

  let theme = getInitialTheme();
  let runtimeSummaryText = "";
  let panelsSignature = "";
  let runtimeWebSocketDemo: RuntimeWebSocketDemo | null = null;
  const { runtimeCardHost } = renderDashboardShell({
    root: options.root,
    theme,
    frameworkId: options.frameworkId,
  });

  const { controlsHost, summaryEl, panelsHost } = createRuntimeCard(
    runtimeCardHost,
    options.frameworkId,
  );

  const actionControlMap = createActionControlMap(controlsHost, (actionId) => {
    void controller.runAction(actionId);
  });
  const themeButton = createThemeToggleButton(controlsHost);

  let clockTimer: ReturnType<typeof setInterval> | null = null;

  const syncRuntime = (state: DashboardControllerState, now = Date.now()) => {
    const runtimeState = buildRuntimeUiState(state, now);

    if (runtimeSummaryText !== runtimeState.runtimeSummary) {
      runtimeSummaryText = runtimeState.runtimeSummary;
      summaryEl.textContent = runtimeState.runtimeSummary;
    }

    syncControlButtons(actionControlMap, runtimeState.controls);

    const nextPanelsSignature = createRuntimePanelsSignature(
      runtimeState.runtimeSections,
    );
    if (panelsSignature !== nextPanelsSignature) {
      panelsSignature = nextPanelsSignature;
      runtimeWebSocketDemo?.dispose();
      runtimeWebSocketDemo = null;
      panelsHost.replaceChildren(
        ...createRuntimePanels(runtimeState.runtimeSections),
      );
    } else {
      syncRuntimePanels(panelsHost, runtimeState.runtimeSections);
    }

    const websocketSection = runtimeState.runtimeSections.find(
      (section) => section.id === "runtime-websocket",
    );
    const endpoint = getTextCellText(
      websocketSection?.rows.find((row) => row.key === "gateway-route")?.value,
    );
    const gatewayAvailable =
      getBadgeCellText(
        websocketSection?.rows.find((row) => row.key === "capability")?.value,
      ) === "Available";
    const runtimeSection = runtimeState.runtimeSections.find(
      (section) => section.id === "runtime-control",
    );
    const runtimeKey =
      getTextCellText(
        runtimeSection?.rows.find((row) => row.key === "started")?.value,
      ) ?? "not-running";
    if (
      gatewayAvailable &&
      endpoint &&
      (runtimeWebSocketDemo?.endpoint !== endpoint ||
        runtimeWebSocketDemo.runtimeKey !== runtimeKey)
    ) {
      runtimeWebSocketDemo?.dispose();
      runtimeWebSocketDemo = mountRuntimeWebSocketDemo(
        panelsHost,
        endpoint,
        runtimeKey,
      );
    }
    if ((!gatewayAvailable || !endpoint) && runtimeWebSocketDemo) {
      runtimeWebSocketDemo.dispose();
      runtimeWebSocketDemo = null;
    }
  };

  setThemeIcon(themeButton, theme);
  themeButton.addEventListener("click", () => {
    theme = toggleTheme(theme);
    applyTheme(theme);
    options.root.setAttribute("data-theme", theme);
    setThemeIcon(themeButton, theme);
  });

  const unsubscribe = controller.subscribe((nextState) => {
    syncRuntime(nextState);
  });

  applyTheme(theme);
  controller.start();
  clockTimer = setInterval(() => {
    syncRuntime(controller.getState());
  }, 1000);

  return () => {
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    unsubscribe();
    runtimeWebSocketDemo?.dispose();
    controller.stop();
  };
}
