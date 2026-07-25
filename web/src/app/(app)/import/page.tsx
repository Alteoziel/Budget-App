import { redirect } from "next/navigation";

/** Import lives under Settings now. */
export default function ImportPage() {
  redirect("/settings?import=1");
}
