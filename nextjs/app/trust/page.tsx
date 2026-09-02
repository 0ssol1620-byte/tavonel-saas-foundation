import { permanentRedirect } from "next/navigation";

export default function TrustRedirect() {
  permanentRedirect("/security");
}
