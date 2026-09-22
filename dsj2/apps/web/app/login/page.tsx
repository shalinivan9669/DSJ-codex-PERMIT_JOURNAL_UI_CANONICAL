import { redirect } from "next/navigation";
import { LoginForm } from "../../components/login-form";
import { getCurrentSession, getDefaultAuthenticatedPath } from "../../lib/auth";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) redirect(getDefaultAuthenticatedPath(session.user));
  return <main className="flex min-h-screen items-center justify-center bg-[var(--canvas)] px-5 py-12">
    <section className="w-full max-w-md space-y-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-8">
      <p className="text-sm font-semibold text-[var(--accent)]">DEMO</p>
      <h1 className="text-3xl font-semibold">Печать документов</h1>
      <p className="text-sm text-[var(--muted)]">Удостоверения, сертификаты, свидетельства и связанные печатные протоколы.</p>
      <LoginForm />
    </section>
  </main>;
}
