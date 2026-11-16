import { MCP_TOOLS } from "@/lib/mcp-tools";
import s from "./tool-list.module.css";

/** The MCP tools, from `MCP_TOOLS`: the names, the count and the descriptions have one owner. */
export function ToolList({ tools = MCP_TOOLS }: { tools?: typeof MCP_TOOLS }) {
  return (
    <ul className={s.list}>
      {tools.map(([name, description]) => (
        <li key={name} className={s.item}>
          <code className={s.name}>{name}</code>
          <span className={s.description}>{description}</span>
        </li>
      ))}
    </ul>
  );
}
