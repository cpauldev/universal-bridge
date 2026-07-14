import {
  ArrowLeft,
  ArrowUpRight,
  File,
  FileCode2,
  FileJson2,
  FileText,
  FolderOpen,
  type LucideIcon,
  Search,
} from "lucide-react";

import { formatBytes, formatDate } from "./format.js";
import type { FileMetadata, OverlayAction, OverlayState } from "./types.js";
import { Button } from "./ui/button.js";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty.js";
import { FileTree, filterFileTree } from "./ui/file-tree.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "./ui/input-group.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { SidebarMenuButton } from "./ui/sidebar.js";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip.js";
import { cn } from "./ui/utils.js";

const FILE_TYPE_ICONS: Record<
  string,
  { icon: LucideIcon; colorClass: string }
> = {
  tsx: { icon: FileCode2, colorClass: "text-cyan-600 dark:text-cyan-400" },
  jsx: { icon: FileCode2, colorClass: "text-cyan-600 dark:text-cyan-400" },
  ts: { icon: FileCode2, colorClass: "text-blue-600 dark:text-blue-400" },
  js: { icon: FileCode2, colorClass: "text-yellow-600 dark:text-yellow-400" },
  mjs: { icon: FileCode2, colorClass: "text-yellow-600 dark:text-yellow-400" },
  cjs: { icon: FileCode2, colorClass: "text-yellow-600 dark:text-yellow-400" },
  vue: { icon: FileCode2, colorClass: "text-green-600 dark:text-green-400" },
  svelte: {
    icon: FileCode2,
    colorClass: "text-orange-600 dark:text-orange-400",
  },
  astro: {
    icon: FileCode2,
    colorClass: "text-orange-600 dark:text-orange-400",
  },
  json: { icon: FileJson2, colorClass: "text-yellow-600 dark:text-yellow-400" },
  jsonc: {
    icon: FileJson2,
    colorClass: "text-yellow-600 dark:text-yellow-400",
  },
  md: { icon: FileText, colorClass: "text-zinc-500 dark:text-zinc-400" },
  mdx: { icon: FileText, colorClass: "text-violet-600 dark:text-violet-400" },
  html: { icon: FileCode2, colorClass: "text-orange-600 dark:text-orange-400" },
};

const DEFAULT_FILE_TYPE_ICON = {
  icon: File,
  colorClass: "text-muted-foreground",
};

function resolveFilesEmptyMessage(state: OverlayState): string {
  if (!state.hasBootstrapped) {
    return "Connecting to bridge...";
  }

  if (state.transportState === "bridge_detecting") {
    return "Detecting bridge connection...";
  }

  if (state.transportState === "runtime_starting") {
    return "Runtime is starting. Files will appear when ready.";
  }

  if (
    state.transportState === "disconnected" ||
    state.transportState === "degraded" ||
    !state.connected
  ) {
    return state.errorMessage
      ? `Connection unavailable: ${state.errorMessage}`
      : "Connection unavailable. Files cannot be loaded.";
  }

  return "No files found.";
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

function KvRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "muted" | "code";
}) {
  return (
    <div className="overlay-kv-row text-xs leading-[1.35]">
      <span className="text-muted-foreground">{label}</span>
      <span className={resolveToneClassName(tone)}>{value || "n/a"}</span>
    </div>
  );
}

function FileTypeIcon({ path }: { path: string }) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const entry = FILE_TYPE_ICONS[extension] ?? DEFAULT_FILE_TYPE_ICON;
  const Icon = entry.icon;
  return (
    <Icon
      aria-hidden="true"
      className={cn("size-3.5 shrink-0", entry.colorClass)}
    />
  );
}

export interface WorkspaceSidebarProps {
  state: OverlayState;
  onDispatch: (action: OverlayAction) => void;
  onLoadFileMetadata: (path: string) => void;
}

export function WorkspaceSidebar({
  state,
  onDispatch,
  onLoadFileMetadata,
}: WorkspaceSidebarProps) {
  const q = state.fileFilter.trim();
  const filteredResult = q ? filterFileTree(state.fileTree, q) : null;
  const displayNodes = filteredResult?.nodes ?? state.fileTree;
  const forceExpand = filteredResult?.forceExpand;
  const showFilterEmpty =
    q.length > 0 && state.fileTree.length > 0 && displayNodes.length === 0;

  return (
    <aside className="overlay-sidebar overlay-sidebar--workspace">
      <nav
        className="overlay-nav-tabs overlay-nav-tabs--workspace"
        aria-label="Universal Overlay files navigation"
        role="tablist"
        aria-orientation="vertical"
      >
        <div className="overlay-workspace-nav">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="max-sm:hidden"
                  aria-label="Back to Runtime"
                  role="tab"
                  aria-selected={false}
                  aria-controls="overlay-panel"
                />
              }
              onClick={() => onDispatch({ type: "setTab", tab: "runtime" })}
            >
              <ArrowLeft aria-hidden="true" size={14} />
            </TooltipTrigger>
            <TooltipPopup side="right">Back to Runtime</TooltipPopup>
          </Tooltip>
          <SidebarMenuButton
            className="min-w-0 cursor-default justify-start disabled:pointer-events-none disabled:opacity-100 aria-disabled:opacity-100"
            disabled
            aria-disabled="true"
            tabIndex={-1}
            isActive
          >
            <FolderOpen aria-hidden="true" />
            <span>Files</span>
          </SidebarMenuButton>
        </div>
        <div className="overlay-workspace-search">
          <InputGroup>
            <InputGroupAddon aria-hidden="true">
              <Search className="size-4" />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={state.fileFilter}
              placeholder="Search files"
              aria-label="Search files"
              onChange={(e) =>
                onDispatch({
                  type: "setFileFilter",
                  fileFilter: e.target.value,
                })
              }
            />
          </InputGroup>
        </div>
      </nav>
      <ScrollArea className="overlay-sidebar-scroll">
        <div className="overlay-workspace-content">
          {state.treeLoading && state.fileTree.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              Loading...
            </p>
          ) : state.fileTree.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {resolveFilesEmptyMessage(state)}
            </p>
          ) : showFilterEmpty ? (
            <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              No files match your search.
            </p>
          ) : (
            <FileTree
              nodes={displayNodes}
              selectedPath={state.selectedFilePath}
              forceExpand={forceExpand}
              onFileClick={(path) => {
                onDispatch({ type: "setSelectedFilePath", path });
                onLoadFileMetadata(path);
              }}
              fileIconRenderer={(node) => <FileTypeIcon path={node.path} />}
            />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function FileMetadataPanel({
  meta,
  onOpenFile,
}: {
  meta: FileMetadata;
  onOpenFile: (path: string) => void;
}) {
  return (
    <div className="overlay-file-details">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 break-all text-sm font-semibold">
          <FileTypeIcon path={meta.path} />
          {meta.name}
        </p>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => onOpenFile(meta.path)}
        >
          Open in editor
          <ArrowUpRight aria-hidden="true" size={14} />
        </Button>
      </div>
      <div className="overlay-section">
        <h4 className="text-xs font-semibold uppercase tracking-[0.05em] text-muted-foreground">
          Metadata
        </h4>
        <div className="overlay-kv-grid">
          <KvRow label="Name" value={meta.name} />
          <KvRow label="Path" value={meta.path} />
          {meta.absolutePath && (
            <KvRow label="Full path" value={meta.absolutePath} />
          )}
          <KvRow
            label="Type"
            value={meta.isDirectory ? "Directory" : meta.extension || "File"}
          />
          <KvRow label="Size" value={formatBytes(meta.size)} />
          {meta.lines !== undefined && (
            <KvRow label="Lines" value={meta.lines.toLocaleString()} />
          )}
          <KvRow label="Modified" value={formatDate(meta.modified)} />
          <KvRow label="Created" value={formatDate(meta.created)} />
        </div>
      </div>
    </div>
  );
}

export function FilesPane({
  state,
  onOpenFile,
}: {
  state: OverlayState;
  onOpenFile: (path: string) => void;
}) {
  if (state.selectedFilePath && state.fileMetadata) {
    return (
      <section className="overlay-pane">
        <FileMetadataPanel meta={state.fileMetadata} onOpenFile={onOpenFile} />
      </section>
    );
  }
  if (state.selectedFilePath && state.fileMetadataLoading) {
    return (
      <section className="overlay-pane">
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Loading...
        </p>
      </section>
    );
  }
  return (
    <section className="overlay-pane overlay-pane--empty">
      <Empty className="h-full border-0 p-6 md:p-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText aria-hidden="true" size={18} />
          </EmptyMedia>
          <EmptyTitle>Select a file</EmptyTitle>
          <EmptyDescription>
            Choose a file from the left panel to view details.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}
