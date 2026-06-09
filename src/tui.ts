import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createElement, insert, setProp } from "@opentui/solid";

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

function renderSidebar(theme: {
  accent: unknown;
  text: unknown;
  textMuted: unknown;
}): JSX.Element {
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
        ],
      ),
      box({ width: "100%", marginTop: 1 }, [
        text({ fg: theme.text }, ["Hello World"]),
      ]),
    ],
  );
}

const plugin: TuiPluginModule & { id: string } = {
  id: `${PLUGIN_NAME}:tui`,
  tui: async (api) => {
    api.slots.register({
      order: 900,
      slots: {
        sidebar_content() {
          return renderSidebar(api.theme.current);
        },
      },
    });
  },
};

export default plugin;
