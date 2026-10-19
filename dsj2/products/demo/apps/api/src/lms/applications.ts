import { randomUUID } from "node:crypto";
import { z } from "@demo/contracts";
import { Prisma } from "@demo/database";
import { courseContentSchema, regulatoryProfileSchema } from "@demo/contracts/src/lms";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
  type DemoRequest,
} from "../core";
import { rateLimit } from "../auth";
import { assertLmsDeploymentAllowed } from "./deployment-gate";
import { assertLmsStaff, employerMemberships, isLmsStaff } from "./scope";
import { runAssignmentChunk } from "./assignment-operations";
import { enqueueEnrollmentNotification } from "./notification-events";
import { assertLocalAssessmentSupported } from "./course-validation";

const states = [
  "NEW",
  "PROCESSING",
  "RETURNED",
  "REJECTED",
  "ACCEPTED",
  "CANCELLED",
] as const;
export const applicationInput = z
  .object({
    kind: z.enum(["B2C", "B2B"]),
    courseVersionId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    customerId: z.string().uuid().optional(),
    organization: z.string().trim().max(300).default(""),
    bin: z.string().trim().max(12).default(""),
    contactName: z.string().trim().max(300).default(""),
    phone: z.string().trim().max(40).default(""),
    email: z.union([z.email().max(255), z.literal("")]).default(""),
    position: z.string().trim().max(200).default(""),
    quantity: z.number().int().min(1).max(10000).default(1),
    comment: z.string().trim().max(2000).default(""),
  })
  .strict();
const catalogueInput = z
  .object({
    enabled: z.boolean(),
    summaryRu: z.string().trim().max(3000),
    summaryKz: z.string().trim().max(3000),
  })
  .strict();
const listInput = z
  .object({
    id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    search: z.string().trim().max(200).default(""),
    state: z.enum(states).optional(),
  })
  .strict();
type Tx = Prisma.TransactionClient;

async function catalogueTenant(c?: Context) {
  const id = c?.tenantId || process.env.DEMO_LMS_REGISTRATION_TENANT_ID;
  const tenant = id
    ? await db.tenant.findFirst({ where: { id, active: true } })
    : null;
  if (!tenant)
    fail(404, "CATALOGUE_UNAVAILABLE", "Каталог центра пока недоступен");
  await assertLmsDeploymentAllowed(tenant);
  return tenant;
}
export async function availableVersion(
  tenantId: string,
  versionId: string,
  tx: Tx = db,
  lock = false,
  publicOnly = true,
) {
  const version = await tx.courseVersion.findFirst({
    where: { tenantId, id: versionId, status: "PUBLISHED" },
  });
  if (!version)
    fail(
      409,
      "APPLICATION_COURSE_UNAVAILABLE",
      "Набор на программу изменился. Выберите программу повторно",
    );
  if (lock)
    await tx.$executeRaw`SELECT id FROM "Course" WHERE "tenantId"=${tenantId} AND id=${version.courseId} FOR UPDATE`;
  const course = await tx.course.findFirst({
    where: {
      tenantId,
      id: version.courseId,
      ...(publicOnly ? { publicCatalogEnabled: true } : {}),
      archived: false,
      assignmentPaused: false,
    },
  });
  const current = await tx.courseVersion.findFirst({
    where: { tenantId, courseId: version.courseId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    select: { id: true },
  });
  if (!course || current?.id !== version.id)
    fail(
      409,
      "APPLICATION_COURSE_UNAVAILABLE",
      "Набор на программу изменился. Выберите программу повторно",
    );
  const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
    where: { tenantId, id: version.regulatoryProfileVersionId },
  });
  assertLocalAssessmentSupported(courseContentSchema.parse(version.content), regulatoryProfileSchema.parse(profile.definition));
  return { course, version };
}
export async function publicCatalogue(query: unknown, c?: Context) {
  const { page, search, versionId } = parse(
    listInput
      .omit({ state: true })
      .extend({ versionId: z.string().uuid().optional() }),
    query,
  );
  const tenant = await catalogueTenant(c);
  const selected = versionId
    ? await availableVersion(tenant.id, versionId)
    : null;
  const where: Prisma.CourseWhereInput = {
    tenantId: tenant.id,
    publicCatalogEnabled: true,
    archived: false,
    assignmentPaused: false,
    ...(selected ? { id: selected.course.id } : {}),
    learningVersions: { some: { status: "PUBLISHED" } },
    ...(search
      ? {
          OR: [
            { titleRu: { contains: search, mode: "insensitive" } },
            { titleKz: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.course.findMany({
      where,
      take: 25,
      skip: (page - 1) * 25,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        learningVersions: {
          where: { status: "PUBLISHED" },
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    }),
    db.course.count({ where }),
  ]);
  return {
    centerName: tenant.name,
    items: rows.map((row) => {
      const version = row.learningVersions[0];
      const content = courseContentSchema.parse(version.content);
      return {
        id: row.id,
        courseVersionId: version.id,
        titleRu: content.titleRu,
        titleKz: content.titleKz,
        summaryRu: row.publicSummaryRu,
        summaryKz: row.publicSummaryKz,
        hours: content.hours,
        durationDays: content.metadata?.durationDays,
        available: true,
      };
    }),
    page,
    pageSize: 25,
    total,
  };
}
export async function coursePublicity(c: Context, id: string, input?: unknown) {
  assertLmsStaff(c);
  if (input === undefined) {
    const row = await db.course.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!row) fail(404, "NOT_FOUND", "Курс не найден");
    return {
      enabled: row.publicCatalogEnabled,
      summaryRu: row.publicSummaryRu,
      summaryKz: row.publicSummaryKz,
    };
  }
  const value = parse(catalogueInput, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Course" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    if (!(await tx.course.findFirst({ where: { tenantId: c.tenantId, id } })))
      fail(404, "NOT_FOUND", "Курс не найден");
    await tx.course.update({
      where: { id },
      data: {
        publicCatalogEnabled: value.enabled,
        publicSummaryRu: value.summaryRu,
        publicSummaryKz: value.summaryKz,
      },
    });
    await audit(tx, c, "LMS_CATALOGUE_VISIBILITY_CHANGED", id, {
      enabled: value.enabled,
    });
    return value;
  });
}
export async function applicationDefaults(c: Context) {
  if (c.role !== "LEARNER" && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Заявка доступна слушателю или работодателю");
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: c.userId, active: true },
  });
  const ids =
    c.role === "EMPLOYER"
      ? (await employerMemberships(c)).map((m) => m.customerId)
      : [];
  const organizations = ids.length
    ? await db.customerOrganization.findMany({
        where: { tenantId: c.tenantId, id: { in: ids }, archived: false },
        select: { id: true, nameRu: true, nameKz: true, bin: true },
        orderBy: { nameRu: "asc" },
      })
    : [];
  return { contactName: user.displayName, email: user.email, organizations };
}
export async function submitApplication(
  req: DemoRequest,
  input: unknown,
  c?: Context,
) {
  rateLimit(`application:${c?.userId || req.ip}`, 10);
  const data = parse(applicationInput, input);
  if (!c && (data.kind !== "B2B" || data.customerId))
    fail(400, "APPLICATION_SIGN_IN", "Для личной заявки войдите в кабинет");
  if (c && !["LEARNER", "EMPLOYER"].includes(c.role))
    fail(403, "ROLE_DENIED", "Заявка доступна слушателю или работодателю");
  if (c?.role === "EMPLOYER" && data.kind !== "B2B")
    fail(403, "ROLE_DENIED", "Выберите заявку организации");
  const tenant = await catalogueTenant(c);
  const key = hash(
    `${c ? `user:${c.userId}` : "anonymous"}:${data.idempotencyKey}`,
  );
  const inputHash = hash(data);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenant.id + ":application:" + key},0))`;
    const prior = await tx.lmsApplication.findFirst({
      where: { tenantId: tenant.id, idempotencyKey: key },
    });
    if (prior) {
      if (prior.inputHash !== inputHash)
        fail(
          409,
          "APPLICATION_PAYLOAD_CONFLICT",
          "Состав заявки изменился. Отправьте её как новую заявку",
        );
      return {
        id: prior.id,
        state: prior.state,
        centerName: tenant.name,
        saved: true,
      };
    }
    await availableVersion(tenant.id, data.courseVersionId, tx, true);
    if (
      (await tx.lmsApplication.count({
        where: {
          tenantId: tenant.id,
          actorId: null,
          createdAt: { gte: new Date(Date.now() - 86400000) },
        },
      })) >= 2000 &&
      !c
    )
      fail(
        429,
        "APPLICATION_LIMIT",
        "Приём заявок временно ограничен. Повторите позже",
      );
    let recipientId: string | null = null,
      customerId: string | null = null;
    let contact = {
      organization: data.organization,
      bin: data.bin,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email,
      position: data.position,
    };
    if (data.kind === "B2C") {
      if (!c || c.role !== "LEARNER" || data.customerId || data.quantity !== 1)
        fail(400, "APPLICATION_PERSONAL_INVALID", "Проверьте личную заявку");
      const profile = await tx.learnerProfile.findFirst({
        where: { tenantId: tenant.id, userId: c.userId },
      });
      const user = await tx.user.findFirst({
        where: { tenantId: tenant.id, id: c.userId, active: true },
      });
      if (!profile || !user)
        fail(403, "LEARNER_LINK_REQUIRED", "Завершите регистрацию слушателя");
      recipientId = profile.recipientId;
      contact = {
        organization: "",
        bin: "",
        contactName: user.displayName,
        email: user.email,
        phone: "",
        position: "",
      };
    } else {
      if (data.customerId) {
        if (
          !c ||
          c.role !== "EMPLOYER" ||
          !(await employerMemberships(c, false, tx)).some(
            (m) => m.customerId === data.customerId,
          )
        )
          fail(404, "NOT_FOUND", "Организация недоступна");
        const organization = await tx.customerOrganization.findFirst({
          where: { tenantId: tenant.id, id: data.customerId, archived: false },
        });
        if (!organization) fail(404, "NOT_FOUND", "Организация недоступна");
        customerId = organization.id;
        contact.organization = organization.nameRu;
        contact.bin = organization.bin;
      }
      if (c) {
        const user = await tx.user.findFirstOrThrow({
          where: { tenantId: tenant.id, id: c.userId, active: true },
        });
        contact.contactName = user.displayName;
        contact.email = user.email;
      }
      if (
        !contact.organization ||
        (!customerId && !/^\d{12}$/.test(contact.bin)) ||
        !contact.contactName ||
        !contact.email ||
        !contact.phone
      )
        fail(
          400,
          "APPLICATION_CONTACT_REQUIRED",
          "Укажите организацию, БИН из 12 цифр, контактное лицо, телефон и почту",
        );
    }
    const result = await tx.lmsApplication.create({
      data: {
        tenantId: tenant.id,
        kind: data.kind,
        courseVersionId: data.courseVersionId,
        actorId: c?.userId || null,
        recipientId,
        customerId,
        contact: json(contact),
        quantity: data.quantity,
        comment: data.comment,
        idempotencyKey: key,
        inputHash,
      },
    });
    await audit(
      tx,
      c || {
        tenantId: tenant.id,
        userId: "anonymous",
        role: "ANONYMOUS",
        sessionId: "",
        csrfHash: "",
        correlationId: req.correlationId,
        source: "public-application",
      },
      "LMS_APPLICATION_CREATED",
      result.id,
      { kind: result.kind, courseVersionId: result.courseVersionId },
    );
    return {
      id: result.id,
      state: result.state,
      centerName: tenant.name,
      saved: true,
    };
  });
}
export async function applicationScope(
  c: Context,
  tx: Tx = db,
): Promise<Prisma.LmsApplicationWhereInput> {
  if (isLmsStaff(c)) return { tenantId: c.tenantId };
  if (c.role === "LEARNER") {
    const profile = await tx.learnerProfile.findFirst({
      where: { tenantId: c.tenantId, userId: c.userId },
    });
    return {
      tenantId: c.tenantId,
      OR: [
        { kind: "B2C", recipientId: profile?.recipientId || "unavailable" },
        { kind: "B2B", actorId: c.userId },
      ],
    };
  }
  if (c.role === "EMPLOYER")
    return {
      tenantId: c.tenantId,
      OR: [
        { actorId: c.userId, customerId: null },
        {
          customerId: {
            in: (await employerMemberships(c, false, tx)).map(
              (m) => m.customerId,
            ),
          },
        },
      ],
    };
  fail(403, "ROLE_DENIED", "Недостаточно прав");
}
export async function listApplications(c: Context, query: unknown) {
  const q = parse(listInput, query);
  const scope = await applicationScope(c);
  const where: Prisma.LmsApplicationWhereInput = {
    AND: [scope],
    ...(q.id ? { id: q.id } : {}),
    ...(!q.id && q.state ? { state: q.state } : {}),
    ...(!q.id && q.search
      ? {
          OR: [
            { contact: { path: ["organization"], string_contains: q.search } },
            { contact: { path: ["contactName"], string_contains: q.search } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.lmsApplication.findMany({
      where,
      take: 50,
      skip: q.id ? 0 : (q.page - 1) * 50,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    db.lmsApplication.count({ where }),
  ]);
  const [versions, owners] = await Promise.all([
    db.courseVersion.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: rows.map((r) => r.courseVersionId) },
      },
      select: { id: true, content: true },
    }),
    db.user.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: rows.flatMap((r) => (r.assignedTo ? [r.assignedTo] : [])) },
      },
      select: { id: true, displayName: true },
    }),
  ]);
  return {
    items: rows.map(({ idempotencyKey: _key, inputHash: _hash, ...row }) => {
      const content = courseContentSchema.parse(
        versions.find((v) => v.id === row.courseVersionId)!.content,
      );
      return {
        ...row,
        titleRu: content.titleRu,
        titleKz: content.titleKz,
        ownerName:
          owners.find((o) => o.id === row.assignedTo)?.displayName || null,
      };
    }),
    total,
    page: q.page,
    pageSize: 50,
  };
}
export async function scopedApplication(c: Context, id: string, tx: Tx = db) {
  const row = await tx.lmsApplication.findFirst({
    where: { id, ...(await applicationScope(c, tx)) },
  });
  if (!row) fail(404, "NOT_FOUND", "Заявка не найдена");
  return row;
}
const actionInput = z
  .object({
    action: z.enum([
      "TAKE",
      "RETURN",
      "REJECT",
      "ACCEPT",
      "CANCEL",
      "RESUBMIT",
    ]),
    revision: z.number().int().nonnegative(),
    reason: z.string().trim().max(2000).default(""),
    customerId: z.string().uuid().optional(),
    createOrganization: z.boolean().default(false),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict();
export async function actOnApplication(c: Context, id: string, input: unknown) {
  const data = parse(actionInput, input);
  const row = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsApplication" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const old = await scopedApplication(c, id, tx);
    if (data.action === "ACCEPT" && old.state === "ACCEPTED" && isLmsStaff(c))
      return old;
    if (old.revision !== data.revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Заявка уже изменена. Обновите состояние; введённые данные сохранены",
      );
    if (["CANCEL", "RESUBMIT"].includes(data.action)) {
      const linkedPersonal = c.role === "LEARNER" && old.kind === "B2C" && !!old.recipientId && !!(await tx.learnerProfile.findFirst({ where: { tenantId: c.tenantId, userId: c.userId, recipientId: old.recipientId } }));
      if ((old.actorId !== c.userId && !linkedPersonal) || !["LEARNER", "EMPLOYER"].includes(c.role))
        fail(403, "ROLE_DENIED", "Недостаточно прав");
      if (data.action === "CANCEL" && !["NEW", "RETURNED"].includes(old.state))
        fail(409, "APPLICATION_STATE", "Заявка уже обрабатывается центром");
      if (data.action === "RESUBMIT" && old.state !== "RETURNED")
        fail(409, "APPLICATION_STATE", "Заявка не ожидает уточнения");
      if (data.action === "RESUBMIT")
        await availableVersion(c.tenantId, old.courseVersionId, tx, true);
      const state = data.action === "CANCEL" ? "CANCELLED" : "NEW";
      const updated = await tx.lmsApplication.update({
        where: { id },
        data: {
          state,
          revision: { increment: 1 },
          ...(data.comment !== undefined ? { comment: data.comment } : {}),
        },
      });
      await audit(tx, c, `LMS_APPLICATION_${data.action}`, id, { state });
      return updated;
    }
    assertLmsStaff(c);
    if (!["NEW", "PROCESSING", "RETURNED"].includes(old.state))
      fail(409, "APPLICATION_STATE", "Заявка уже обработана");
    if (["RETURN", "REJECT"].includes(data.action) && !data.reason)
      fail(400, "REASON_REQUIRED", "Укажите причину и необходимое исправление");
    let customerId = old.customerId,
      orderId = old.orderId,
      operationId = old.operationId;
    if (data.action === "ACCEPT") {
      const { course } = await availableVersion(
        c.tenantId,
        old.courseVersionId,
        tx,
        true,
        false,
      );
      if (old.kind === "B2B") {
        if (
          old.customerId &&
          data.customerId &&
          old.customerId !== data.customerId
        )
          fail(
            409,
            "APPLICATION_ORGANIZATION_CONFLICT",
            "Подтверждённая организация заявки не может быть заменена",
          );
        if (data.customerId) {
          if (
            !(await tx.customerOrganization.findFirst({
              where: {
                id: data.customerId,
                tenantId: c.tenantId,
                archived: false,
              },
            }))
          )
            fail(404, "NOT_FOUND", "Организация не найдена");
          customerId = data.customerId;
        } else if (!customerId && data.createOrganization) {
          const contact = old.contact as { organization: string; bin: string };
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":application-organization:" + contact.bin},0))`;
          if (
            await tx.customerOrganization.findFirst({
              where: {
                tenantId: c.tenantId,
                bin: contact.bin,
                archived: false,
              },
              select: { id: true },
            })
          )
            fail(
              409,
              "APPLICATION_ORGANIZATION_EXISTS",
              "Организация с этим БИН уже существует. Выберите проверенную запись",
            );
          customerId = (
            await tx.customerOrganization.create({
              data: {
                tenantId: c.tenantId,
                nameRu: contact.organization,
                bin: contact.bin,
              },
            })
          ).id;
        }
        if (!customerId)
          fail(
            400,
            "APPLICATION_ORGANIZATION_REQUIRED",
            "Подтвердите существующую организацию или создание новой",
          );
      }
      if (
        old.kind === "B2C" &&
        ((await tx.enrollment.findFirst({
          where: {
            tenantId: c.tenantId,
            recipientId: old.recipientId!,
            courseVersionId: old.courseVersionId,
          },
        })) ||
          (await tx.lmsApplication.findFirst({
            where: {
              tenantId: c.tenantId,
              kind: "B2C",
              recipientId: old.recipientId,
              courseVersionId: old.courseVersionId,
              state: "ACCEPTED",
              id: { not: old.id },
            },
          })))
      )
        fail(
          409,
          "APPLICATION_ALREADY_ENROLLED",
          "Обучение уже назначено. Верните заявку с пояснением",
        );
      if (
        old.kind === "B2C" && old.actorId &&
        (!(await tx.learnerProfile.findFirst({
          where: {
            tenantId: c.tenantId,
            userId: old.actorId!,
            recipientId: old.recipientId!,
          },
        })) ||
          !(await tx.user.findFirst({
            where: { tenantId: c.tenantId, id: old.actorId!, active: true },
            select: { id: true },
          })))
      )
        fail(
          409,
          "LEARNER_LINK_REQUIRED",
          "Связь слушателя изменилась. Требуется проверка центра",
        );
      const order = await tx.serviceOrder.create({
        data: {
          tenantId: c.tenantId,
          title: `Обучение · ${course.titleRu}`.slice(0, 300),
          customerId,
          employerId: customerId,
          ownerId: c.userId,
          contact: JSON.stringify(old.contact),
          createdBy: c.userId,
        },
      });
      orderId = order.id;
      operationId = old.kind === "B2C" ? randomUUID() : null;
      await audit(tx, c, "ORDER_CREATED_FROM_LMS_APPLICATION", order.id, {
        applicationId: id,
      });
    }
    const state = {
      TAKE: "PROCESSING",
      RETURN: "RETURNED",
      REJECT: "REJECTED",
      ACCEPT: "ACCEPTED",
    }[data.action as "TAKE" | "RETURN" | "REJECT" | "ACCEPT"];
    const updated = await tx.lmsApplication.update({
      where: { id },
      data: {
        state,
        assignedTo: c.userId,
        reason: data.reason || null,
        customerId,
        orderId,
        operationId,
        revision: { increment: 1 },
      },
    });
    await audit(tx, c, `LMS_APPLICATION_${data.action}`, id, {
      state,
      orderId,
      customerId,
    });
    return updated;
  });
  if (row.state === "ACCEPTED" && row.kind === "B2C" && !row.enrollmentId) {
    assertLmsStaff(c);
    // Order acceptance is durable. An interrupted assignment resumes with this exact operation.
    const owner = await db.user.findFirst({
      where: {
        tenantId: c.tenantId,
        id: row.assignedTo!,
        active: true,
        role: { in: ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR"] },
      },
    });
    if (!owner)
      fail(
        409,
        "APPLICATION_OWNER_UNAVAILABLE",
        "Ответственный больше не имеет права назначения. Обратитесь к администратору",
      );
    const result = await runAssignmentChunk(
      { ...c, userId: owner.id, role: owner.role },
      {
        courseVersionId: row.courseVersionId,
        recipientIds: [row.recipientId!],
        sourceOrderId: row.orderId!,
        operationId: row.operationId!,
      },
    );
    const enrollment = await db.enrollment.findFirst({
      where: {
        tenantId: c.tenantId,
        recipientId: row.recipientId!,
        courseVersionId: row.courseVersionId,
        sourceOrderId: row.orderId!,
      },
    });
    if (!enrollment || result.errors.length || result.conflicts)
      fail(
        409,
        "APPLICATION_ASSIGNMENT_PENDING",
        "Заказ сохранён. Назначение ожидает исправления; повторите принятие после проверки программы",
      );
    await transaction(async (tx) => {
      await tx.lmsApplication.update({
        where: { id: row.id },
        data: { enrollmentId: enrollment.id },
      });
      await enqueueEnrollmentNotification(tx, enrollment, "ENROLLED", {
        key: `ASSIGNMENT:${enrollment.id}`,
      });
    });
  }
  const final = await scopedApplication(c, id);
  return {
    id: final.id,
    state: final.state,
    revision: final.revision,
    orderId: final.orderId,
    enrollmentId: final.enrollmentId,
  };
}
