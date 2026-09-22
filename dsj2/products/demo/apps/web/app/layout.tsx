import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DEMO — подготовка и печать документов",
  description:
    "Рабочее пространство учебного центра: заявки, получатели и печатные документы.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
