# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# opencode-tui
- Do not install @opentui/core, @opentui/solid, or @opentui/keymap as devDependencies — they are host-provided by the OpenCode runtime and native bindings break npm install. Reference them only via type imports from @opencode-ai/plugin/tui. Confidence: 0.85
- When implementing OpenCode plugin features (TUI, server, etc.), consult existing reference plugins (e.g., OMO-Slim) for correct patterns rather than guessing at the API surface. Confidence: 0.65

