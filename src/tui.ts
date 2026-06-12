import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createElement, insert, setProp } from "@opentui/solid";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeOverrides, saveRuntimeOverride } from "./core/runtime-overrides.js";

let _version: string | undefined;
function getVersion(): string {
  if (_version !== undefined) return _version;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    _version = pkg.version ?? "dev";
  } catch {
    _version = "dev";
  }
  return _version!;
}

type WatcherState = {
  running: boolean;
  lastRunAt: number | undefined;
};

type RagStatus = {
  chunkCount: number;
  provider: string;
  model: string;
  lastIndexedAt: number | undefined;
  indexed: boolean;
  watcher: WatcherState;
};

const DEFAULT_STATUS: RagStatus = {
  chunkCount: 0,
  provider: "ollama",
  model: "",
  lastIndexedAt: undefined,
  indexed: false,
  watcher: { running: false, lastRunAt: undefined },
};

function loadWatcherStatus(storePath: string): WatcherState {
  const statusPath = join(storePath, "watcher-status.json");
  if (!existsSync(statusPath)) return { running: false, lastRunAt: undefined };
  try {
    const raw: Record<string, unknown> = JSON.parse(readFileSync(statusPath, "utf-8"));
    return {
      running: raw.running === true,
      lastRunAt: typeof raw.lastRunAt === "number" ? raw.lastRunAt : undefined,
    };
  } catch {
    return { running: false, lastRunAt: undefined };
  }
}

function loadRagStatus(worktree: string): RagStatus {
  const status = { ...DEFAULT_STATUS };

  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const configPath = join(worktree, loc);
    if (!existsSync(configPath)) continue;
    try {
      const cfg: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf-8"));
      const embedding = cfg.embedding as Record<string, unknown> | undefined;
      if (embedding) {
        status.provider = (embedding.provider as string) ?? status.provider;
        status.model = (embedding.model as string) ?? status.model;
      }
      const vs = cfg.vectorStore as Record<string, unknown> | undefined;
      const storeRelPath = (vs?.path as string) ?? ".opencode/rag_db";
      const storePath = resolve(worktree, storeRelPath);

      const manifestPath = join(storePath, "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
        const files = manifest.files as Record<string, { chunkCount?: number }> | undefined;
        if (files && typeof files === "object") {
          status.chunkCount = Object.values(files).reduce(
            (sum: number, entry) => sum + (entry.chunkCount ?? 0),
            0
          );
        }
        status.lastIndexedAt = manifest.lastIndexedAt as number | undefined;
        status.indexed = status.chunkCount > 0;
      }

      status.watcher = loadWatcherStatus(storePath);
      break;
    } catch {
      continue;
    }
  }

  return status;
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return "never";
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type Child = JSX.Element | string | number | null | undefined | false;

const PLUGIN_NAME = "opencode-rag-plugin";

function element(
  tag: string,
  props: Record<string, unknown>,
  children: Child[] = [],
): JSX.Element {
  const node = createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    insert(node, child);
  }
  return node as unknown as JSX.Element;
}

function text(props: Record<string, unknown>, children: Child[] = []): JSX.Element {
  return element("text", props, children);
}

function box(props: Record<string, unknown>, children: Child[] = []): JSX.Element {
  return element("box", props, children);
}

function renderSidebar(
  theme: { accent: unknown; text: unknown; textMuted: unknown },
  version: string,
  status: RagStatus,
): JSX.Element {
  const statusLine = status.indexed
    ? `${status.chunkCount} chunks \u00B7 ${status.provider}/${status.model}`
    : "Not indexed";
  const timeLine = `Indexed ${formatRelativeTime(status.lastIndexedAt)}`;

  const watcherRunning = status.watcher.running;
  const watcherLine = watcherRunning
    ? "Watcher running\u2026"
    : `Watcher idle \u00B7 last ${formatRelativeTime(status.watcher.lastRunAt)}`;

  return box(
    {
      width: "100%",
      flexDirection: "column",
      border: { type: "single" },
      borderColor: theme.accent,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 1,
      paddingRight: 1,
    },
    [
      box(
        {
          width: "100%",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        [
          box({ paddingLeft: 1, paddingRight: 1, backgroundColor: theme.accent }, [
            text({ fg: "#000000" }, ["OpenCodeRAG"]),
          ]),
          text({ fg: theme.textMuted }, [`v${version}`]),
        ],
      ),
      text({ fg: theme.text }, [statusLine]),
      text({ fg: theme.textMuted }, [timeLine]),
      text({ fg: watcherRunning ? theme.accent : theme.textMuted }, [watcherLine]),
      text({ fg: theme.textMuted }, ["Ctrl+Shift+R Settings"]),
    ],
  );
}

// ── Settings dialog ────────────────────────────────────────────────

function getConfigPath(worktree: string): string | undefined {
  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const p = join(worktree, loc);
    if (existsSync(p)) return p;
  }
  return undefined;
}

function readJsonFile<T = Record<string, unknown>>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

type SettingEntry = {
  path: string[];
  label: string;
  type: "boolean" | "number";
  currentValue: boolean | number;
};

type SettingCategory = {
  id: string;
  label: string;
  entries: SettingEntry[];
};

function buildSettingCategories(
  cfg: Record<string, unknown>,
  ro: Record<string, unknown>,
): SettingCategory[] {
  const retrievalCfg = (cfg.retrieval ?? {}) as Record<string, unknown>;
  const retrievalRo = (ro.retrieval ?? {}) as Record<string, unknown>;
  const retrievalHybridCfg = (retrievalCfg.hybridSearch ?? {}) as Record<string, unknown>;
  const retrievalHybridRo = (retrievalRo.hybridSearch ?? {}) as Record<string, unknown>;

  const openCodeCfg = (cfg.openCode ?? {}) as Record<string, unknown>;
  const openCodeRo = (ro.openCode ?? {}) as Record<string, unknown>;
  const aiCfg = (openCodeCfg.autoIndex ?? {}) as Record<string, unknown>;
  const aiRo = (openCodeRo.autoIndex ?? {}) as Record<string, unknown>;
  const ajCfg = (openCodeCfg.autoInject ?? {}) as Record<string, unknown>;
  const ajRo = (openCodeRo.autoInject ?? {}) as Record<string, unknown>;

  const descCfg = (cfg.description ?? {}) as Record<string, unknown>;
  const descRo = (ro.description ?? {}) as Record<string, unknown>;

  return [
    {
      id: "retrieval",
      label: "Retrieval",
      entries: [
        {
          path: ["retrieval", "topK"],
          label: "Top-K results",
          type: "number",
          currentValue: (retrievalRo.topK as number) ?? (retrievalCfg.topK as number) ?? 10,
        },
        {
          path: ["retrieval", "minScore"],
          label: "Min relevance score",
          type: "number",
          currentValue: (retrievalRo.minScore as number) ?? (retrievalCfg.minScore as number) ?? 0.5,
        },
        {
          path: ["retrieval", "hybridSearch", "enabled"],
          label: "Hybrid search",
          type: "boolean",
          currentValue: (retrievalHybridRo.enabled as boolean) ?? (retrievalHybridCfg.enabled as boolean) ?? true,
        },
        {
          path: ["retrieval", "hybridSearch", "keywordWeight"],
          label: "Keyword weight",
          type: "number",
          currentValue: (retrievalHybridRo.keywordWeight as number) ?? (retrievalHybridCfg.keywordWeight as number) ?? 0.4,
        },
      ],
    },
    {
      id: "autoindex",
      label: "Auto-Indexing",
      entries: [
        {
          path: ["openCode", "autoIndex", "enabled"],
          label: "Auto-index watcher",
          type: "boolean",
          currentValue: (aiRo.enabled as boolean) ?? (aiCfg.enabled as boolean) ?? true,
        },
        {
          path: ["openCode", "autoIndex", "debounceMs"],
          label: "Debounce (ms)",
          type: "number",
          currentValue: (aiRo.debounceMs as number) ?? (aiCfg.debounceMs as number) ?? 2000,
        },
      ],
    },
    {
      id: "autoinject",
      label: "Auto-Inject",
      entries: [
        {
          path: ["openCode", "autoInject", "enabled"],
          label: "Auto-inject context",
          type: "boolean",
          currentValue: (ajRo.enabled as boolean) ?? (ajCfg.enabled as boolean) ?? true,
        },
        {
          path: ["openCode", "autoInject", "minScore"],
          label: "Inject min score",
          type: "number",
          currentValue: (ajRo.minScore as number) ?? (ajCfg.minScore as number) ?? 0.75,
        },
        {
          path: ["openCode", "autoInject", "maxChunks"],
          label: "Inject max chunks",
          type: "number",
          currentValue: (ajRo.maxChunks as number) ?? (ajCfg.maxChunks as number) ?? 3,
        },
      ],
    },
    {
      id: "description",
      label: "LLM Descriptions",
      entries: [
        {
          path: ["description", "enabled"],
          label: "LLM descriptions",
          type: "boolean",
          currentValue: (descRo.enabled as boolean) ?? (descCfg.enabled as boolean) ?? true,
        },
      ],
    },
  ];
}

async function openSettingsDialog(api: {
  ui: {
    dialog: { replace: (fn: () => JSX.Element, onClose?: () => void) => void; clear: () => void };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DialogSelect: (props: any) => JSX.Element;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DialogPrompt: (props: any) => JSX.Element;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toast: (input: any) => void;
  };
  state: { path: { worktree: string | undefined } };
}): Promise<void> {
  const worktree = api.state.path.worktree;
  if (!worktree) return;

  const configPath = getConfigPath(worktree);
  if (!configPath) {
    api.ui.toast({ variant: "error", title: "Settings", message: "No config file found" });
    return;
  }

  const cfgRaw = readJsonFile(configPath);
  if (!cfgRaw) {
    api.ui.toast({ variant: "error", title: "Settings", message: "Cannot read config" });
    return;
  }

  const cfg: Record<string, unknown> = cfgRaw;
  const vs = cfg.vectorStore as Record<string, unknown> | undefined;
  const storeRelPath = (vs?.path as string) ?? ".opencode/rag_db";
  const storePath = resolve(worktree, storeRelPath);

  function getCurrentOverrides(): Record<string, unknown> {
    return loadRuntimeOverrides(storePath) as unknown as Record<string, unknown>;
  }

  // Build options for a category or setting list
  function showCategoryMenu(): void {
    const ro = getCurrentOverrides();
    const cats = buildSettingCategories(cfg, ro);
    const options = [
      ...cats.map((c) => ({
        title: c.label,
        value: c.id,
        description: `${c.entries.length} setting${c.entries.length === 1 ? "" : "s"}`,
      })),
      { title: "Done", value: "__done__", description: "Close settings" },
    ];

    api.ui.dialog.replace(
      () =>
        api.ui.DialogSelect({
          title: "OpenCodeRAG Settings",
          placeholder: "Select a category",
          options,
          onSelect: (option: { title: string; value: string }) => {
            if (option.value === "__done__") {
              api.ui.dialog.clear();
              return;
            }
            const cat = cats.find((c) => c.id === option.value);
            if (cat) showSettingMenu(cat);
          },
        }),
    );
  }

  function showSettingMenu(cat: SettingCategory): void {
    const options = [
      ...cat.entries.map((s) => ({
        title: `${s.label}: ${s.type === "boolean" ? (s.currentValue ? "Yes" : "No") : String(s.currentValue)}`,
        value: s.path.join("."),
        description: s.type === "boolean" ? "Select to toggle" : "Select to edit",
      })),
      { title: "\u2190 Back", value: "__back__", description: "Return to categories" },
    ];

    api.ui.dialog.replace(
      () =>
        api.ui.DialogSelect({
          title: cat.label,
          placeholder: "Select a setting",
          options,
          onSelect: (option: { title: string; value: string }) => {
            if (option.value === "__back__") {
              showCategoryMenu();
              return;
            }
            const entry = cat.entries.find((s) => s.path.join(".") === option.value);
            if (!entry) return;

            if (entry.type === "boolean") {
              const newVal = !entry.currentValue;
              saveRuntimeOverride(storePath, entry.path, newVal);
              api.ui.toast({
                variant: "success",
                title: "Settings",
                message: `${entry.label}: ${newVal ? "Yes" : "No"}`,
              });
              entry.currentValue = newVal;
              showSettingMenu(cat);
            } else {
              api.ui.dialog.replace(
                () =>
                  api.ui.DialogPrompt({
                    title: `Edit ${entry.label}`,
                    placeholder: "Enter new value",
                    value: String(entry.currentValue),
                    onConfirm: (input: string) => {
                      const num = parseFloat(input);
                      if (!isNaN(num)) {
                        saveRuntimeOverride(storePath, entry.path, num);
                        api.ui.toast({
                          variant: "success",
                          title: "Settings",
                          message: `${entry.label}: ${num}`,
                        });
                        entry.currentValue = num;
                      }
                      showSettingMenu(cat);
                    },
                    onCancel: () => {
                      showSettingMenu(cat);
                    },
                  }),
              );
            }
          },
        }),
    );
  }

  showCategoryMenu();
}

// ── Plugin export ──────────────────────────────────────────────────

const plugin: TuiPluginModule & { id: string } = {
  id: `${PLUGIN_NAME}:tui`,
  tui: async (api, _options, meta) => {
    const version = meta.version ?? getVersion();
    let cachedStatus: RagStatus = DEFAULT_STATUS;
    let lastRefresh = 0;
    const REFRESH_INTERVAL_MS = 30_000;

    function refreshStatus() {
      const worktree = api.state.path.worktree;
      if (worktree) {
        cachedStatus = loadRagStatus(worktree);
        lastRefresh = Date.now();
      }
    }

    refreshStatus();

    // Register sidebar slot
    api.slots.register({
      order: 900,
      slots: {
        sidebar_content() {
          if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
            refreshStatus();
          }
          return renderSidebar(api.theme.current, version, cachedStatus);
        },
      },
    });

    // Register keybinding for settings dialog
    try {
      api.keymap.registerLayer({
        bindings: [{ key: "ctrl+shift+r", cmd: "opencode-rag:settings" }],
        commands: [
          {
            name: "opencode-rag:settings",
            run: () => {
              openSettingsDialog({
                ui: api.ui,
                state: api.state,
              });
              return undefined;
            },
          },
        ],
      });
    } catch (err) {
      // Keymap registration may fail in older OpenCode versions; silently skip
    }
  },
};

export default plugin;
