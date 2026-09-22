import {
  profileSchema,
  customerSchema,
  roleSchema,
  z,
  today,
} from "@demo/contracts";
import {
  db,
  fail,
  parse,
  audit,
  transaction,
  json,
  type Context,
} from "./core";
import { passwordSchema, passwordHash } from "./auth";
export async function context(c: Context, csrfToken: string) {
  const [user, tenant, profile, templates, numbering] = await Promise.all([
    db.user.findFirstOrThrow({
      where: { id: c.userId, tenantId: c.tenantId },
      select: { id: true, email: true, displayName: true, role: true },
    }),
    db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
    getProfile(c),
    db.templateVersion.findMany({
      where: { tenantId: c.tenantId },
      orderBy: { templateId: "asc" },
    }),
    db.numberSequence.findMany({
      where: { tenantId: c.tenantId },
      orderBy: { namespace: "asc" },
    }),
  ]);
  return {
    user,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      timezone: tenant.timezone,
      demoOnly: tenant.demoOnly,
      today: today(tenant.timezone),
    },
    profile: profile?.profile || null,
    profileVersionId: profile?.id,
    templates,
    numbering,
    csrfToken,
  };
}
export function getProfile(c: Context) {
  return db.issuerProfileVersion.findFirst({
    where: { tenantId: c.tenantId },
    orderBy: { version: "desc" },
  });
}
export async function saveProfile(c: Context, input: unknown) {
  const profile = parse(profileSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + "profile"},0))`;
    const previous = await tx.issuerProfileVersion.findFirst({
      where: { tenantId: c.tenantId },
      orderBy: { version: "desc" },
    });
    const record = await tx.issuerProfileVersion.create({
      data: {
        tenantId: c.tenantId,
        version: (previous?.version || 0) + 1,
        profile: json(profile),
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "PROFILE_VERSION_CREATED", record.id, {
      version: record.version,
    });
    return record;
  });
}
export async function saveCustomer(c: Context, input: unknown, id?: string) {
  const data = parse(customerSchema, input);
  if (
    id &&
    !(await db.customerOrganization.findFirst({
      where: { id, tenantId: c.tenantId },
    }))
  )
    fail(404, "NOT_FOUND", "Заказчик не найден");
  return db.$transaction(async (tx) => {
    const result = id
      ? await tx.customerOrganization.update({ where: { id }, data })
      : await tx.customerOrganization.create({
          data: { tenantId: c.tenantId, ...data },
        });
    await audit(tx, c, id ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED", result.id);
    return result;
  });
}
export async function saveUser(c: Context, input: unknown, id?: string) {
  const create = z
    .object({
      email: z.email().max(255),
      displayName: z.string().min(1).max(255),
      role: roleSchema,
      password: passwordSchema,
    })
    .strict();
  const patch = create
    .omit({ email: true })
    .partial()
    .extend({ disabled: z.boolean().optional() })
    .strict();
  const data: z.infer<typeof patch> & { email?: string } = id
    ? parse(patch, input)
    : parse(create, input);
  const target = id
    ? await db.user.findFirst({ where: { id, tenantId: c.tenantId } })
    : null;
  if (id && !target) fail(404, "NOT_FOUND", "Пользователь не найден");
  if (
    id === c.userId &&
    (("disabled" in data && data.disabled) ||
      (data.role && data.role !== "ADMIN"))
  )
    fail(
      409,
      "SELF_LOCKOUT",
      "Для отключения своей учётной записи используйте другого администратора",
    );
  const digest = data.password ? await passwordHash(data.password) : undefined;
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":users"},0))`;
    const currentTarget = id
      ? await tx.user.findFirst({ where: { id, tenantId: c.tenantId } })
      : null;
    if (id && !currentTarget) fail(404, "NOT_FOUND", "Пользователь не найден");
    if (
      currentTarget?.role === "ADMIN" &&
      currentTarget.active &&
      ((data.role && data.role !== "ADMIN") ||
        ("disabled" in data && data.disabled))
    ) {
      const count = await tx.user.count({
        where: { tenantId: c.tenantId, role: "ADMIN", active: true },
      });
      if (count <= 1)
        fail(
          409,
          "LAST_ADMIN",
          "В центре должен остаться действующий администратор",
        );
    }
    const fields = {
      displayName: data.displayName,
      role: data.role,
      passwordHash: digest,
      ...("disabled" in data && data.disabled !== undefined
        ? { active: !data.disabled }
        : {}),
    };
    const user = id
      ? await tx.user.update({
          where: { id },
          data: { ...fields, sessionVersion: { increment: 1 } },
        })
      : await tx.user.create({
          data: {
            tenantId: c.tenantId,
            email: (data as z.infer<typeof create>).email.toLowerCase(),
            displayName: data.displayName!,
            role: data.role!,
            passwordHash: digest!,
          },
        });
    if (id)
      await tx.session.deleteMany({
        where: { userId: id, tenantId: c.tenantId },
      });
    await audit(
      tx,
      c,
      id ? "USER_UPDATED_SESSIONS_REVOKED" : "USER_CREATED",
      user.id,
    );
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      disabled: !user.active,
    };
  });
}
export async function updateNumbering(c: Context, input: unknown) {
  const data = parse(
    z
      .object({
        namespace: z
          .string()
          .regex(
            /^(BIOT|PTM|PB|PS):(CARD|CERTIFICATE|PROTOCOL|WITNESS|REGISTRATION)$/,
          ),
        prefix: z.string().max(30),
        suffix: z.string().max(30).default(""),
        padding: z.number().int().min(1).max(12).default(5),
        startAt: z.number().int().min(1).max(2_000_000_000).optional(),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":" + data.namespace},0))`;
    const old = await tx.numberSequence.findUnique({
      where: {
        tenantId_namespace: { tenantId: c.tenantId, namespace: data.namespace },
      },
    });
    if (data.startAt !== undefined && old?.value)
      fail(
        409,
        "SEQUENCE_ALREADY_USED",
        "Начало нумерации можно задать только до первого выпуска",
      );
    const value =
      data.startAt !== undefined ? data.startAt - 1 : old?.value || 0;
    const result = await tx.numberSequence.upsert({
      where: {
        tenantId_namespace: { tenantId: c.tenantId, namespace: data.namespace },
      },
      create: {
        tenantId: c.tenantId,
        namespace: data.namespace,
        value,
        prefix: data.prefix,
        suffix: data.suffix,
        padding: data.padding,
      },
      update: {
        value,
        prefix: data.prefix,
        suffix: data.suffix,
        padding: data.padding,
        policyVersion: { increment: 1 },
      },
    });
    await audit(tx, c, "NUMBER_POLICY_UPDATED", data.namespace, {
      policyVersion: result.policyVersion,
    });
    return result;
  });
}
