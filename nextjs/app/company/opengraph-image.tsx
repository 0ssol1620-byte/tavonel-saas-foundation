import { ogCard } from "@/lib/og-card";
import { v34Route } from "@/lib/v34/routes";

export { alt, contentType, size } from "@/lib/og-card";

const route = v34Route("company");

export default ogCard(route.ogLabel, route.description);
