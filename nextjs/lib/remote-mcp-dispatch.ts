import { AsyncLocalStorage } from "node:async_hooks";

/*
  W1-A1 token audience (review R1 M1). A token minted by the remote MCP's OAuth flow is a
  `tvnl_mcp_` key: developer-auth accepts it only while /api/mcp is dispatching one of its tools to
  a /api/v1 handler in this process. Sent straight to /api/v1 -- or anywhere else -- it is refused,
  so turning the MCP switch off or leaving its cohort (both checked at /api/mcp) ends the token
  everywhere. The marker is the async context, not a header: nothing an HTTP caller sends sets it.
*/
const dispatching = new AsyncLocalStorage<true>();

export const insideRemoteMcpDispatch = () => dispatching.getStore() === true;
export const withinRemoteMcpDispatch = <T,>(run: () => T): T => dispatching.run(true, run);
