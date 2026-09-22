import Link from "next/link";

export function PrintingShell({ children, fullName, companyName }: {
  children: React.ReactNode; fullName: string; companyName: string | null;
}) {
  return <div className="min-h-screen bg-[var(--canvas)]">
    <header className="border-b border-[var(--line)] bg-[var(--surface)] px-6 py-4">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
        <Link className="text-xl font-semibold" href="/certificates">DEMO</Link>
        <nav aria-label="Печать"><Link className="text-sm font-medium" href="/certificates/biot-experimental">Заявки и удостоверения</Link></nav>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span>{companyName} · {fullName}</span>
          <form action="/api/auth/logout" method="post"><button className="rounded border px-3 py-2" type="submit">Выйти</button></form>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
  </div>;
}
