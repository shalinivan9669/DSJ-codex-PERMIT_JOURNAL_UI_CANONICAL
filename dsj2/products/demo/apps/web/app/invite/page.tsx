import type { Metadata } from "next";
import { EmployerInviteAccept } from "@/components/employer-invite-accept";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Приглашение представителя — OT Center",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function InvitePage() {
  return <EmployerInviteAccept />;
}
