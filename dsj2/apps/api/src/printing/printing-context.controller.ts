import { Controller, Get } from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { PrismaService } from "../database/prisma.service";

/** Only the legacy printing selector; no CompaniesModule or workforce access. */
@Controller("printing")
export class PrintingContextController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("context")
  @Roles("COMPANY_ADMIN", "SAFETY_ENGINEER", "SUPER_ADMIN")
  async context(@CurrentUser() user: AuthenticatedUser) {
    const companies = await this.prisma.company.findMany({
      where: user.role === "SUPER_ADMIN" ? {} : { id: user.companyId ?? "__no_scope__" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { companies };
  }
}
