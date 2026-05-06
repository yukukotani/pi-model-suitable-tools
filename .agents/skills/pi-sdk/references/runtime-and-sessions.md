# Runtime And Sessions

## SessionManager choices

Use `SessionManager` to control persistence.

Common choices:

- `SessionManager.inMemory()`: no file persistence; good for tests and request-scoped runs.
- `SessionManager.create(cwd)`: new persistent session.
- `SessionManager.continueRecent(cwd)`: restore the most recent session.
- `SessionManager.open(path)`: open a known session file.

Listing helpers:

- `SessionManager.list(cwd)`
- `SessionManager.listAll(cwd)`

## AgentSessionRuntime

Use `createAgentSessionRuntime()` when the host app must replace the active session instead of creating a fresh standalone one.

Typical reasons:

- new session
- resume another saved session
- fork
- import from JSONL
- rebuild cwd-bound services when the active session changes

Core pattern:

```ts
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
} from "@mariozechner/pi-coding-agent";

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
	const services = await createAgentSessionServices({ cwd });
	return {
		...(await createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent,
		})),
		services,
		diagnostics: services.diagnostics,
	};
};

const runtime = await createAgentSessionRuntime(createRuntime, {
	cwd: process.cwd(),
	agentDir: getAgentDir(),
	sessionManager: SessionManager.create(process.cwd()),
});
```

## Replacement methods

`AgentSessionRuntime` owns replacement across:

- `newSession()`
- `switchSession(path)`
- `fork(entryId)`
- `importFromJsonl(path)`

Important behavior:

- `runtime.session` changes after replacement.
- existing subscriptions stay attached to the old session.
- if extensions are used, call `runtime.session.bindExtensions(...)` again.
- diagnostics are available on `runtime.diagnostics`.
- runtime creation or replacement can throw.

Rebind pattern:

```ts
let unsubscribe = runtime.session.subscribe(handleEvent);

await runtime.newSession();

unsubscribe();
await runtime.session.bindExtensions({});
unsubscribe = runtime.session.subscribe(handleEvent);
```

## Tree and branch behavior

`AgentSession` already supports:

- `navigateTree(...)`
- `compact(...)`
- model and thinking changes

Use runtime only when the active session instance itself must be replaced.

## Host-app guidance

Prefer this split:

- app shell owns `AgentSessionRuntime`
- current view/controller owns subscriptions to `runtime.session`
- on runtime replacement, dispose view-local bindings and recreate them against the new session

This avoids stale listeners and stale UI bindings.
