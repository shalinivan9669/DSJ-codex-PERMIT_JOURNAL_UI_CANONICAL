import { redirect } from "next/navigation";

import { PrintingShell } from "@/components/printing-shell";
import { requireSession } from "../../lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  if (!session.user) {
    redirect("/login");
  }

  return (
    <PrintingShell
      companyName={
        session.user.company?.name ?? "DEMO"
      }
      fullName={session.user.fullName}
    >
      {children}
    </PrintingShell>
  );
}
