import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  COMPLETED_STATUSES,
  IN_PRODUCTION_STATUSES,
  OPEN_STATUSES,
  ORDER_STATUSES,
  PIPELINE,
  REVIEW_STATUSES,
  type OrderStatusValue,
} from "@/lib/status";
import { dateOnly, todayIso, addDaysIso } from "@/lib/utils";
import type { Actor } from "../actor";
import { orderScope } from "./access";
import { overdueWhere } from "./overdue";
import { normalizePoNumber } from "./duplicates";

export interface OrderFilters {
  q?: string;
  status?: string; // a status, or a group: open | review | production | completed | overdue | all | dueSoon
  engineerId?: string;
  customerId?: string;
  from?: string;
  to?: string;
  delayed?: boolean;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORTS: Record<string, (dir: "asc" | "desc") => Prisma.OrderOrderByWithRelationInput> = {
  order: (dir) => ({ orderNumber: { sort: dir, nulls: "last" } }),
  customer: (dir) => ({ customer: { name: dir } }),
  machine: (dir) => ({ machineName: { sort: dir, nulls: "last" } }),
  engineer: (dir) => ({ engineer: { name: dir } }),
  status: (dir) => ({ status: dir }),
  progress: (dir) => ({ progressPercentage: dir }),
  poDate: (dir) => ({ poDate: { sort: dir, nulls: "last" } }),
  expected: (dir) => ({ expectedCompletionDate: { sort: dir, nulls: "last" } }),
  lastUpdate: (dir) => ({ lastUpdateAt: { sort: dir, nulls: "last" } }),
  created: (dir) => ({ createdAt: dir }),
};

export function searchWhere(q: string): Prisma.OrderWhereInput {
  const term = q.trim();
  if (!term) return {};
  const norm = normalizePoNumber(term);
  const or: Prisma.OrderWhereInput[] = [
    { orderNumber: { contains: term, mode: "insensitive" } },
    { poNumber: { contains: term, mode: "insensitive" } },
    { customer: { name: { contains: term, mode: "insensitive" } } },
    { machineName: { contains: term, mode: "insensitive" } },
    { machineModel: { contains: term, mode: "insensitive" } },
    { engineer: { name: { contains: term, mode: "insensitive" } } },
  ];
  // "PO-4587" should find a PO stored as "4587" and vice versa.
  if (norm && norm !== term) or.push({ poNumber: { contains: norm, mode: "insensitive" } });
  return { OR: or };
}

export function statusWhere(status: string | undefined, today = todayIso()): Prisma.OrderWhereInput {
  switch (status) {
    case undefined:
    case "":
    case "open":
      return { status: { in: OPEN_STATUSES as OrderStatus[] } };
    case "all":
      return {};
    case "review":
      return { status: { in: REVIEW_STATUSES as OrderStatus[] } };
    case "production":
      return { status: { in: IN_PRODUCTION_STATUSES as OrderStatus[] } };
    case "completed":
      return { status: { in: COMPLETED_STATUSES as OrderStatus[] } };
    case "overdue":
      return overdueWhere(today);
    case "dueSoon":
      return {
        status: { in: ["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"] },
        expectedCompletionDate: { gte: dateOnly(today), lte: dateOnly(addDaysIso(today, 7)) },
      };
    default:
      return (ORDER_STATUSES as readonly string[]).includes(status) ? { status: status as OrderStatus } : {};
  }
}

export async function listOrders(f: OrderFilters, actor: Actor) {
  const today = todayIso();
  const where: Prisma.OrderWhereInput = {
    AND: [
      orderScope(actor),
      statusWhere(f.status, today),
      f.q ? searchWhere(f.q) : {},
      f.engineerId ? (f.engineerId === "none" ? { engineerId: null } : { engineerId: f.engineerId }) : {},
      f.customerId ? { customerId: f.customerId } : {},
      f.from ? { poDate: { gte: dateOnly(f.from) } } : {},
      f.to ? { poDate: { lte: dateOnly(f.to) } } : {},
      f.delayed ? overdueWhere(today) : {},
    ],
  };
  const dir = f.dir === "asc" ? "asc" : "desc";
  const orderBy = (SORTS[f.sort ?? ""] ?? SORTS.created!)(dir);
  const pageSize = Math.min(5000, f.pageSize ?? 50);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [orderBy, { createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true } },
        engineer: { select: { id: true, name: true } },
        currentStage: { select: { name: true } },
        purchaseOrders: { select: { duplicateStatus: true, extractionStatus: true }, take: 1, orderBy: { createdAt: "asc" } },
        _count: { select: { images: { where: { kind: "MACHINE" } } } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return { rows, total, page, pageSize, today };
}

export type OrderListRow = Awaited<ReturnType<typeof listOrders>>["rows"][number];

export async function getOrderDetail(orderId: string, actor: Actor) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, ...orderScope(actor) },
    include: {
      customer: true,
      engineer: { select: { id: true, name: true, email: true, phone: true } },
      currentStage: true,
      stageProgress: { include: { stage: true, updatedBy: { select: { name: true } } } },
      dailyUpdates: {
        orderBy: { createdAt: "desc" },
        include: { stage: true, engineer: { select: { name: true } }, images: true },
      },
      images: { where: { kind: "MACHINE" }, orderBy: { createdAt: "asc" }, include: { uploadedBy: { select: { name: true } } } },
      documents: { orderBy: { createdAt: "asc" } },
      purchaseOrders: { orderBy: { createdAt: "asc" } },
      duplicateOf: { select: { id: true, orderId: true, subject: true } },
      dispatch: { include: { packedBy: { select: { name: true } }, dispatchedBy: { select: { name: true } } } },
      notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
      notifications: actor.role === "ADMIN" ? { orderBy: { createdAt: "desc" }, take: 50 } : false,
    },
  });
  if (!order) return null;
  const stages = await prisma.assemblyStage.findMany({ orderBy: { sequence: "asc" } });
  // Active stages + any inactive stage this order has already touched.
  const tracker = stages
    .map((s) => {
      const p = order.stageProgress.find((sp) => sp.stageId === s.id);
      return { stage: s, progress: p ?? null };
    })
    .filter((t) => t.stage.active || (t.progress && t.progress.status !== "PENDING"));
  const audits =
    actor.role === "ADMIN"
      ? await prisma.auditLog.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take: 300 })
      : await prisma.auditLog.findMany({
          where: { orderId, action: { in: ["ENGINEER_ASSIGNED", "ENGINEER_REASSIGNED", "ENGINEER_ACCEPTED", "STAGE_CHANGED", "DAILY_UPDATE_ADDED", "PHOTO_UPLOADED", "PHOTO_DELETED", "PHOTOS_SUBMITTED", "MACHINE_COMPLETED", "STATUS_CHANGED"] } },
          orderBy: { createdAt: "desc" },
          take: 100,
        });
  return { order, tracker, audits, today: todayIso() };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;

// ------------------------------------------------------------------ dashboard

export async function adminDashboard() {
  const today = todayIso();
  const grouped = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  const count = (statuses: readonly string[]) =>
    grouped.filter((g) => statuses.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
  const [overdue, recent, workload, newPoToday] = await Promise.all([
    prisma.order.count({ where: overdueWhere(today) }),
    prisma.auditLog.findMany({
      where: {
        action: {
          in: ["PO_IMPORTED", "ORDER_CREATED", "ORDER_APPROVED", "ENGINEER_ASSIGNED", "ENGINEER_REASSIGNED", "ENGINEER_ACCEPTED", "DAILY_UPDATE_ADDED", "ISSUE_REPORTED", "MACHINE_COMPLETED", "PHOTOS_SUBMITTED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED", "WHATSAPP_FAILED", "EMAIL_FAILED", "EMAIL_SENT"],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 14,
      include: { order: { select: { orderNumber: true, id: true } } },
    }),
    engineerWorkload(),
    prisma.purchaseOrder.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) }, source: "GMAIL" } }),
  ]);
  const kpis = {
    total: grouped.reduce((n, g) => n + g._count._all, 0),
    open: count(OPEN_STATUSES),
    newPos: count(REVIEW_STATUSES),
    newPoToday,
    inProgress: count(IN_PRODUCTION_STATUSES),
    awaitingEngineer: count(["ORDER_CREATED"]),
    completed: count(COMPLETED_STATUSES),
    readyForDispatch: count(["READY_FOR_DISPATCH"]),
    packed: count(["PACKED"]),
    onHold: count(["ON_HOLD"]),
    dispatched: count(["DISPATCHED", "CLOSED"]),
    overdue,
  };
  const pipeline = PIPELINE.map((p) => ({ ...p, count: count(p.statuses) }));
  return { kpis, pipeline, recent, workload, today };
}

export async function engineerWorkload() {
  const today = todayIso();
  const engineers = await prisma.user.findMany({
    where: { role: "ENGINEER" },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, phone: true, active: true, lastLoginAt: true },
  });
  const grouped = await prisma.order.groupBy({ by: ["engineerId", "status"], where: { engineerId: { not: null } }, _count: { _all: true } });
  const overdue = await prisma.order.groupBy({ by: ["engineerId"], where: { ...overdueWhere(today), engineerId: { not: null } }, _count: { _all: true } });
  return engineers.map((e) => {
    const mine = grouped.filter((g) => g.engineerId === e.id);
    const c = (s: readonly string[]) => mine.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    return {
      ...e,
      assigned: c(["ASSIGNED"]),
      inProgress: c(["ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING"]),
      completed: c(["COMPLETED", "PHOTOS_UPLOADED", "PACKED", "READY_FOR_DISPATCH", "DISPATCHED", "CLOSED"]),
      onHold: c(["ON_HOLD"]),
      overdue: overdue.find((o) => o.engineerId === e.id)?._count._all ?? 0,
      active: e.active,
      openLoad: c(["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING", "ON_HOLD"]),
    };
  });
}

export async function engineerDashboard(actor: Actor) {
  const today = todayIso();
  const scope = orderScope(actor);
  const include = { customer: { select: { name: true } }, currentStage: { select: { name: true } } } as const;
  const orders = await prisma.order.findMany({
    where: { ...scope, status: { notIn: ["CANCELLED"] } },
    include,
    orderBy: [{ expectedCompletionDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return { orders, today };
}

export async function globalSearch(q: string, actor: Actor, take = 20) {
  if (q.trim().length < 2) return [];
  return prisma.order.findMany({
    where: { AND: [orderScope(actor), searchWhere(q)] },
    take,
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true } }, engineer: { select: { name: true } } },
  });
}

// -------------------------------------------------------------------- reports

export async function reportData(from?: string, to?: string) {
  const where: Prisma.OrderWhereInput = {
    ...(from || to ? { createdAt: { ...(from ? { gte: dateOnly(from) } : {}), ...(to ? { lt: dateOnly(addDaysIso(to, 1)) } : {}) } } : {}),
    status: { not: "CANCELLED" },
  };
  const today = todayIso();
  const orders = await prisma.order.findMany({
    where,
    include: { customer: { select: { name: true } }, engineer: { select: { id: true, name: true } }, currentStage: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const byStatus = new Map<string, number>();
  const byCustomer = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byEngineer = new Map<string, { name: string; assigned: number; completed: number; overdue: number; durations: number[] }>();
  for (const o of orders) {
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
    const cname = o.customer?.name ?? "(no customer)";
    byCustomer.set(cname, (byCustomer.get(cname) ?? 0) + 1);
    const month = o.createdAt.toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    if (o.engineer) {
      const e = byEngineer.get(o.engineer.id) ?? { name: o.engineer.name, assigned: 0, completed: 0, overdue: 0, durations: [] };
      e.assigned++;
      if (o.completedAt) {
        e.completed++;
        const start = o.acceptedAt ?? o.assignedAt;
        if (start) e.durations.push((o.completedAt.getTime() - start.getTime()) / 86400000);
      }
      const expIso = o.expectedCompletionDate?.toISOString().slice(0, 10);
      if (expIso && expIso < today && ["ASSIGNED", "ACCEPTED", "ASSEMBLY_IN_PROGRESS", "TESTING", "ON_HOLD", "ORDER_CREATED"].includes(o.status)) e.overdue++;
      byEngineer.set(o.engineer.id, e);
    }
  }
  const production = {
    completed: orders.filter((o) => o.completedAt).length,
    inAssembly: orders.filter((o) => ["ACCEPTED", "ASSEMBLY_IN_PROGRESS"].includes(o.status)).length,
    testing: orders.filter((o) => o.status === "TESTING").length,
    awaitingPhotos: orders.filter((o) => o.status === "COMPLETED").length,
    packed: orders.filter((o) => o.status === "PACKED").length,
    readyForDispatch: orders.filter((o) => o.status === "READY_FOR_DISPATCH").length,
    dispatched: orders.filter((o) => ["DISPATCHED", "CLOSED"].includes(o.status)).length,
  };
  return {
    orders,
    byStatus: ORDER_STATUSES.map((s) => ({ status: s as OrderStatusValue, count: byStatus.get(s) ?? 0 })).filter((r) => r.count),
    byCustomer: [...byCustomer.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    byMonth: [...byMonth.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    engineers: [...byEngineer.values()]
      .map((e) => ({
        name: e.name,
        assigned: e.assigned,
        completed: e.completed,
        overdue: e.overdue,
        avgDays: e.durations.length ? Math.round((e.durations.reduce((a, b) => a + b, 0) / e.durations.length) * 10) / 10 : null,
      }))
      .sort((a, b) => b.assigned - a.assigned),
    production,
  };
}
