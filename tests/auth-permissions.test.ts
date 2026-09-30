import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { authOptions } from "@/server/auth/options";
import { createManualOrder, assignEngineer, acceptOrder, updateOrder, approveOrder } from "@/server/services/orders";
import { findOrderForActor } from "@/server/services/access";
import { listOrders, getOrderDetail, globalSearch } from "@/server/services/queries";
import { markReadyForDispatch, markPacked } from "@/server/services/dispatch";
import { addDailyUpdate } from "@/server/services/daily-updates";
import { createUser, setUserActive } from "@/server/services/users";
import { AppError } from "@/lib/errors";
import { seedBase, PASSWORD, type Base, useRecordingWhatsApp } from "./helpers";

type AuthorizeFn = (c: Record<string, string>, req: { headers: Record<string, string> }) => Promise<unknown>;
const authorize = (authOptions.providers[0] as unknown as { options: { authorize: AuthorizeFn } }).options.authorize;
const login = (email: string, password: string, ip = "10.0.0.1") => authorize({ email, password }, { headers: { "x-forwarded-for": ip } });

let b: Base;
beforeEach(async () => {
  b = await seedBase();
  useRecordingWhatsApp();
});

async function newOrder(po = "PO-1001") {
  return createManualOrder({ customerId: b.customer.id, poNumber: po, machineName: "Steam Sterilizer", quantity: "1", expectedCompletionDate: "2099-01-01" }, b.admin);
}

describe("authentication", () => {
  it("accepts correct credentials and returns the role", async () => {
    const u = (await login("rahul@test.local", PASSWORD)) as { role: string; email: string };
    expect(u).toMatchObject({ email: "rahul@test.local", role: "ENGINEER" });
  });

  it("rejects wrong passwords and unknown users, and audits the failure", async () => {
    expect(await login("rahul@test.local", "wrong-password1")).toBeNull();
    expect(await login("nobody@test.local", PASSWORD)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "USER_LOGIN_FAILED" } })).toBe(2);
  });

  it("stores bcrypt hashes, never plaintext", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "rahul@test.local" } });
    expect(u.passwordHash).not.toContain(PASSWORD);
    expect(u.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });

  it("blocks deactivated users", async () => {
    await setUserActive(b.rahul.id!, false, b.admin);
    expect(await login("rahul@test.local", PASSWORD)).toBeNull();
  });

  it("rate-limits brute force attempts", async () => {
    for (let i = 0; i < 8; i++) await login("priya@test.local", "bad-password-1", "10.0.0.9");
    await expect(login("priya@test.local", PASSWORD, "10.0.0.9")).rejects.toThrow(/Too many login attempts/);
  });

  it("enforces password strength for new users", async () => {
    await expect(createUser({ name: "X", email: "x@test.local", role: "ENGINEER" }, "short", b.admin)).rejects.toThrow();
    await expect(createUser({ name: "X", email: "x@test.local", role: "ENGINEER" }, "LongEnough123", b.rahul)).rejects.toThrow(AppError);
  });
});

describe("role permissions & engineer isolation", () => {
  it("engineers only see orders assigned to them", async () => {
    const o1 = await newOrder("PO-1");
    const o2 = await newOrder("PO-2");
    await assignEngineer(o1.id, b.rahul.id!, b.admin);
    await assignEngineer(o2.id, b.priya.id!, b.admin);

    const rahulList = await listOrders({ status: "all" }, b.rahul);
    expect(rahulList.rows.map((r) => r.id)).toEqual([o1.id]);
    await expect(findOrderForActor(o2.id, b.rahul)).rejects.toThrow(/not found/i);
    expect(await getOrderDetail(o2.id, b.rahul)).toBeNull();
    expect((await globalSearch("PO-2", b.rahul)).length).toBe(0);
    expect((await listOrders({ status: "all" }, b.admin)).total).toBe(2);
  });

  it("engineers cannot act on other engineers' orders", async () => {
    const o = await newOrder();
    await assignEngineer(o.id, b.priya.id!, b.admin);
    await expect(acceptOrder(o.id, b.rahul)).rejects.toThrow(/assigned to this order/);
    await acceptOrder(o.id, b.priya);
    await expect(addDailyUpdate(o.id, { stageId: b.stage("Material Issued").id, progress: "10", workCompleted: "x" }, b.rahul)).rejects.toThrow(/assigned to this order/);
  });

  it("engineers cannot reassign, edit PO/customer data, or dispatch", async () => {
    const o = await newOrder();
    await assignEngineer(o.id, b.rahul.id!, b.admin);
    await expect(assignEngineer(o.id, b.priya.id!, b.rahul)).rejects.toThrow(/admin/i);
    await expect(updateOrder(o.id, { poNumber: "HACK", customerId: b.customer.id }, b.rahul)).rejects.toThrow(/admin/i);
    await expect(markPacked(o.id, {}, b.rahul)).rejects.toThrow(/admin/i);
    await expect(markReadyForDispatch(o.id, b.rahul)).rejects.toThrow(/admin/i);
    await expect(approveOrder(o.id, b.rahul)).rejects.toThrow(/admin/i);
  });

  it("assignment requires an active engineer", async () => {
    const o = await newOrder();
    await expect(assignEngineer(o.id, b.admin.id!, b.admin)).rejects.toThrow(/active engineer/);
    await setUserActive(b.priya.id!, false, b.admin);
    await expect(assignEngineer(o.id, b.priya.id!, b.admin)).rejects.toThrow(/active engineer/);
  });
});
