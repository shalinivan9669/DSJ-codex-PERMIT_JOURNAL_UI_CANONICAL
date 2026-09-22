import type { Metadata } from "next";
import "./globals.css";
import { LocatorDevRuntime } from "./locator-dev-runtime";

export const metadata: Metadata = {
  title: "DEMO — печать документов",
  description: "Подготовка удостоверений, сертификатов, свидетельств и печатных протоколов.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const showLocatorRuntime =
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_ENABLE_LOCATOR === "1";

  return (
    <html lang="ru">
      <body className="font-[family-name:var(--font-sans)] antialiased">
        {children}
        {showLocatorRuntime ? <LocatorDevRuntime /> : null}
      </body>
    </html>
  );
}
