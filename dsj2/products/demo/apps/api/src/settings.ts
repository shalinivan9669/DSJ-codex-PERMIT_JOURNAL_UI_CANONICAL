import {
  profileSchema,
  customerSchema,
  roleSchema,
  z,
  today,
  canManageCenter,
} from "@demo/contracts";
import {
  db,
  fail,
  parse,
  audit,
  transaction,
  json,
  hash,
  type Context,
} from "./core";
import { passwordSchema, passwordHash } from "./auth";
export async function context(c: Context, csrfToken: string) {
  if (c.role === "EMPLOYER") {
    const user = await db.user.findFirstOrThrow({
      where: { id: c.userId, tenantId: c.tenantId },
      select: { id: true, email: true, displayName: true, role: true },
    });
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: c.tenantId },
      select: { id: true, name: true, timezone: true, demoOnly: true },
    });
    return {
      user,
      tenant,
      profile: null,
      profileVersionId: null,
      templates: [],
      numbering: [],
      csrfToken,
    };
  }
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
export async function saveCustomer(
  c: Context,
  input: unknown,
  id?: string,
  idempotencyKey?: unknown,
) {
  const data = parse(customerSchema, input);
  const key =
    typeof idempotencyKey === "string" &&
    /^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)
      ? idempotencyKey
      : undefined;
  if (idempotencyKey !== undefined && !key)
    fail(400, "KEY_INVALID", "Неверный ключ повторяемости команды");
  const payloadHash = hash({ userId: c.userId, data });
  const previous = id
    ? await db.customerOrganization.findFirst({
        where: { id, tenantId: c.tenantId },
      })
    : null;
  if (id && !previous) fail(404, "NOT_FOUND", "Заказчик не найден");
  // A legacy/import client may edit the complete name. Do not retain stale
  // structured metadata or infer a new form from that free text.
  if (
    data.legalForm === undefined &&
    previous &&
    (previous.nameRu !== data.nameRu || previous.nameKz !== data.nameKz)
  ) {
    data.legalForm = null;
    data.ownNameRu = null;
    data.ownNameKz = null;
  }
  return transaction(async (tx) => {
    if (!id && key) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":customer:" + key},0))`;
      const prior = await tx.idempotencyOperation.findUnique({
        where: {
          tenantId_command_idempotencyKey: {
            tenantId: c.tenantId,
            command: "CREATE_CUSTOMER",
            idempotencyKey: key,
          },
        },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          fail(
            409,
            "IDEMPOTENCY_MISMATCH",
            "Этот ключ компании уже использован с другим названием",
          );
        return prior.result as unknown as Awaited<
          ReturnType<typeof tx.customerOrganization.create>
        >;
      }
    }
    const result = id
      ? await tx.customerOrganization.update({ where: { id }, data })
      : await tx.customerOrganization.create({
          data: { tenantId: c.tenantId, ...data },
        });
    await audit(tx, c, id ? "CUSTOMER_UPDATED" : "CUSTOMER_CREATED", result.id);
    if (!id && key)
      await tx.idempotencyOperation.create({
        data: {
          tenantId: c.tenantId,
          command: "CREATE_CUSTOMER",
          idempotencyKey: key,
          payloadHash,
          result: json(result),
        },
      });
    return result;
  });
}
export async function saveUser(c: Context, input: unknown, id?: string) {
  if (!canManageCenter(c.role))
    fail(403, "ROLE_DENIED", "Сотрудниками центра управляет директор");
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
      (data.role && !canManageCenter(data.role)))
  )
    fail(
      409,
      "SELF_LOCKOUT",
      "Для отключения своей учётной записи используйте другого директора",
    );
  const digest = data.password ? await passwordHash(data.password) : undefined;
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":users"},0))`;
    const currentTarget = id
      ? await tx.user.findFirst({ where: { id, tenantId: c.tenantId } })
      : null;
    if (id && !currentTarget) fail(404, "NOT_FOUND", "Пользователь не найден");
    if (
      currentTarget &&
      canManageCenter(currentTarget.role) &&
      currentTarget.active &&
      ((data.role && !canManageCenter(data.role)) ||
        ("disabled" in data && data.disabled))
    ) {
      const count = await tx.user.count({
        where: {
          tenantId: c.tenantId,
          role: { in: ["ADMIN", "DIRECTOR"] },
          active: true,
        },
      });
      if (count <= 1)
        fail(
          409,
          "LAST_DIRECTOR",
          "В центре должен остаться действующий директор",
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
