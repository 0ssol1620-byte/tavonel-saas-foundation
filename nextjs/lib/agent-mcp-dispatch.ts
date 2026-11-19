import { AsyncLocalStorage } from "node:async_hooks";

/*
  Agent proposals v1 audience (workorders/agent-native.md §2.2). A `tvnl_agt_` credential
  authenticates only while /api/agent-mcp is dispatching one of its tools in this process; anywhere
  else lib/developer-store.ts refuses it (API_KEY_AUDIENCE_INVALID). Its own store, never the remote
  MCP's (lib/remote-mcp-dispatch.ts): an agent credential inside the read-only MCP's dispatch is
  still outside this one. The marker is the async context, not a header: nothing an HTTP caller
  sends sets it.
*/
const dispatching = new AsyncLocalStorage<true>();

export const insideAgentMcpDispatch = () => dispatching.getStore() === true;
export const withinAgentMcpDispatch = <T,>(run: () => T): T => dispatching.run(true, run);
