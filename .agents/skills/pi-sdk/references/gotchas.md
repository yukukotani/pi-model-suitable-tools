# Gotchas

## Custom cwd plus explicit tools

If a custom `cwd` is passed and `tools` is also passed, use tool factories for that same `cwd`.

Wrong:

```ts
tools: [readTool, bashTool]
```

Right:

```ts
tools: [createReadTool(cwd), createBashTool(cwd)]
```

## Session replacement changes the live session object

After `runtime.newSession()`, `runtime.switchSession()`, `runtime.fork()`, or `runtime.importFromJsonl()`, the active `runtime.session` is a different object.

Re-subscribe and re-bind extension integrations.

## Runtime replacement can change process cwd

`AgentSessionRuntime` updates the process working directory to the effective session cwd. Do not assume `process.cwd()` stays fixed after session replacement.

## File-mutating custom tools must serialize their own writes

Parallel tool execution means two tools can race on the same file. Wrap the full mutation window in `withFileMutationQueue()`.

## settings setters are not a durability boundary

`SettingsManager` setters update memory immediately, but persistence is async. Call `await settingsManager.flush()` before relying on data being written.

## model fallback is not silent

If a saved session model cannot be restored, `createAgentSession()` can return `modelFallbackMessage`. Surface it in the host app when it matters.

## Custom resource loader changes discovery semantics

If a custom `resourceLoader` is passed, `cwd` and `agentDir` no longer control discovery inside that loader. They still affect session naming and tool path resolution.

## Use the smallest extension surface

Do not build an extension when `customTools` or a resource-loader override is enough. Extensions are more powerful, but they also carry more runtime behavior and rebinding concerns.
