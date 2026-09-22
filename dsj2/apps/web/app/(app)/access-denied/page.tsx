import { requireSession } from "@/lib/auth";

export default async function AccessDeniedPage() {
  await requireSession();
  return <section className="mx-auto max-w-xl space-y-5 py-12">
    <h1 className="text-2xl font-semibold">Нет доступа к печати</h1>
    <p>Попросите администратора центра предоставить права для подготовки печатных документов.</p>
    <form action="/api/auth/logout" method="post"><button type="submit" className="rounded border px-4 py-2">Сменить пользователя</button></form>
  </section>;
}
