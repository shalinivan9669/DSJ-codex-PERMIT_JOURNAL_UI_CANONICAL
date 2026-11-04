import { PrismaClient } from "@prisma/client";
import { bootstrapSuperAdmin, readBootstrapCredentials } from "./bootstrap-super-admin-lib";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--confirm-empty-database") {
    throw new Error("Pass --confirm-empty-database to explicitly run the one-time bootstrap.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  const credentials = readBootstrapCredentials(process.env);
  const prisma = new PrismaClient();
  try {
    await bootstrapSuperAdmin(prisma, credentials);
    console.log("Initial SUPER_ADMIN created.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => {
  // Prisma errors can contain connection details; do not print them or credentials.
  console.error("Initial SUPER_ADMIN was not created. Check the explicit flag, configuration, database connection and that the User table is empty.");
  process.exitCode = 1;
});
