import {
  profileSchema,
  customerSchema,
  roleSchema,
  z,
  today,
  canManageUsers,
  canManageSystem,
  isLmsStaffRole,
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
import { passwordSchema, passwordHash, passwordMatches, rateLimit } from "./auth";
export async function context(c: Context, csrfToken: string) {
  const learningBindings = await db.lmsTeachingBinding.findMany({
    where: { tenantId: c.tenantId, userId: c.userId, revokedAt: null },
    select: { role: true },
  });
  const learningRoles = [...new Set(learningBindings.map((binding) => binding.role))]
    .filter((role) => ["TEACHER", "METHODIST", "EXPERT"].includes(role));
  const canTeach = learningRoles.length > 0;
  const canLearn = !!(await db.learnerProfile.findUnique({
    where: { tenantId_userId: { tenantId: c.tenantId, userId: c.userId } },
    select: { id: true },
  }));
  const canAssignTraining = isLmsStaffRole(c.role) ||
    (c.role === "EMPLOYER" && !!(await db.employerMembership.findFirst({
      where: {
        tenantId: c.tenantId,
        userId: c.userId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        permissions: { array_contains: ["ASSIGN_TRAINING"] },
      },
      select: { id: true },
    })));
  if (
    ["EMPLOYER", "LEARNER", "TEACHER", "METHODIST", "EXPERT"].includes(c.role)
  ) {
    const user = await db.user.findFirstOrThrow({
      where: { id: c.userId, tenantId: c.tenantId },
      select: { id: true, email: true, displayName: true, role: true },
    });
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: c.tenantId },
      select: { id: true, name: true, timezone: true, demoOnly: true },
    });
    return {
      user: { ...user, canTeach, canLearn, learningRoles, canAssignTraining },
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
    user: { ...user, canTeach, canLearn, learningRoles, canAssignTraining },
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
  if (!canManageSystem(c.role)) fail(403, "ROLE_DENIED", "Настройки центра доступны суперадминистратору или директору");
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
  // Only an explicit city entry is evidence; never derive it from an address.
  const cityEvidence =
    data.city === undefined
      ? {}
      : {
          city: data.city || null,
          citySource: data.city ? "OPERATOR_CONFIRMED" : null,
        };
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
      ? await tx.customerOrganization.update({
          where: { id },
          data: { ...data, ...cityEvidence },
        })
      : await tx.customerOrganization.create({
          data: { tenantId: c.tenantId, ...data, ...cityEvidence },
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
  if (!canManageUsers(c.role))
    fail(403, "ROLE_DENIED", "Управление пользователями недоступно для вашей роли");
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
  const digest = data.password ? await passwordHash(data.password) : undefined;
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":users"},0))`;
    await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${c.tenantId} FOR UPDATE`;
    const actor = await tx.user.findFirst({ where: { id: c.userId, tenantId: c.tenantId, active: true } });
    if (!actor || actor.role !== c.role || !canManageUsers(actor.role))
      fail(403, "ROLE_DENIED", "Полномочия изменились. Войдите заново");
    const currentTarget = id
      ? await tx.user.findFirst({ where: { id, tenantId: c.tenantId } })
      : null;
    if (id && !currentTarget) fail(404, "NOT_FOUND", "Пользователь не найден");
    const privileged = ["SUPER_ADMIN", "ADMIN", "DIRECTOR"];
    const nextRole = data.role || currentTarget?.role;
    if (id === c.userId && (data.disabled === true || (data.role && data.role !== actor.role)))
      fail(409, "SELF_ROLE_CHANGE_DENIED", "Свою роль и доступ нельзя изменить здесь. Первого суперадминистратора назначают отдельным подтверждённым действием");
    if (actor.role !== "SUPER_ADMIN" &&
      ((currentTarget && privileged.includes(currentTarget.role)) || (nextRole && privileged.includes(nextRole))))
      fail(403, "PRIVILEGED_USER_REQUIRES_SUPER_ADMIN", "Администраторами, директорами и суперадминистраторами управляет суперадминистратор");
    const changesAccess = !currentTarget || (data.role && data.role !== currentTarget.role) || (data.disabled === false && !currentTarget.active);
    if (changesAccess && nextRole === "LEARNER") {
      const linked = currentTarget && await tx.learnerProfile.findFirst({ where: { tenantId: c.tenantId, userId: currentTarget.id }, select: { id: true } });
      if (!linked) fail(422, "LEARNER_PROFILE_REQUIRED", "Откройте человека в назначении обучения и подготовьте личное приглашение. Оно свяжет доступ с его карточкой");
    }
    if (changesAccess && nextRole === "EMPLOYER") {
      const linked = currentTarget && await tx.employerMembership.findFirst({ where: { tenantId: c.tenantId, userId: currentTarget.id, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } });
      if (!linked) fail(422, "EMPLOYER_MEMBERSHIP_REQUIRED", "Создайте приглашение представителю с выбранной организацией и областью доступа");
    }
    const removesSuper = currentTarget?.role === "SUPER_ADMIN" && currentTarget.active && (data.disabled === true || (data.role && data.role !== "SUPER_ADMIN"));
    if (removesSuper && await tx.user.count({ where: { tenantId: c.tenantId, role: "SUPER_ADMIN", active: true } }) <= 1)
      fail(409, "LAST_SUPER_ADMIN", "В центре должен остаться хотя бы один действующий суперадминистратор");
    if (currentTarget?.active && ["SUPER_ADMIN", "DIRECTOR"].includes(currentTarget.role) &&
      (data.disabled === true || (data.role && !["SUPER_ADMIN", "DIRECTOR"].includes(data.role)))) {
      const count = await tx.user.count({
        where: {
          tenantId: c.tenantId,
          role: { in: ["SUPER_ADMIN", "DIRECTOR"] },
          active: true,
        },
      });
      if (count <= 1)
        fail(
          409,
          "LAST_SYSTEM_MANAGER",
          "В центре должен остаться действующий суперадминистратор или директор",
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
      {
        previous: currentTarget
          ? {
              role: currentTarget.role,
              active: currentTarget.active,
              sessionVersion: currentTarget.sessionVersion,
            }
          : null,
        current: {
          role: user.role,
          active: user.active,
          sessionVersion: user.sessionVersion,
        },
      },
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
export async function bootstrapSuperAdmin(c: Context, input: unknown) {
  if (!["ADMIN", "DIRECTOR"].includes(c.role))
    fail(403, "ROLE_DENIED", "Первое назначение доступно существующему администратору или директору");
  const data = parse(z.object({ currentPassword: z.string().min(1).max(256), confirm: z.literal(true) }).strict(), input);
  rateLimit(`super-admin-bootstrap:${c.tenantId}:${c.userId}`, 5, 15 * 60_000);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":users"},0))`;
    await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${c.tenantId} FOR UPDATE`;
    await tx.$executeRaw`SELECT id FROM "User" WHERE "tenantId"=${c.tenantId} AND id=${c.userId} FOR UPDATE`;
    const actor = await tx.user.findFirst({ where: { tenantId: c.tenantId, id: c.userId, active: true } });
    if (!actor || actor.role !== c.role || !["ADMIN", "DIRECTOR"].includes(actor.role))
      fail(403, "ROLE_DENIED", "Полномочия изменились. Войдите заново");
    if (await tx.user.count({ where: { tenantId: c.tenantId, role: "SUPER_ADMIN", active: true } }))
      fail(409, "SUPER_ADMIN_ALREADY_EXISTS", "Суперадминистратор уже назначен. Обратитесь к нему для изменения прав");
    if (!(await passwordMatches(data.currentPassword, actor.passwordHash)))
      fail(403, "CURRENT_PASSWORD_INVALID", "Текущий пароль не подтверждён");
    await tx.user.update({ where: { id: actor.id }, data: { role: "SUPER_ADMIN", sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { tenantId: c.tenantId, userId: actor.id } });
    await audit(tx, c, "FIRST_SUPER_ADMIN_EXPLICITLY_ASSIGNED", actor.id, { previousRole: actor.role, currentRole: "SUPER_ADMIN", sessionsRevoked: true });
    return { id: actor.id, role: "SUPER_ADMIN", reauthenticate: true };
  });
}
export async function updateNumbering(c: Context, input: unknown) {
  if (!canManageSystem(c.role)) fail(403, "ROLE_DENIED", "Нумерацией управляет суперадминистратор или директор");
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
