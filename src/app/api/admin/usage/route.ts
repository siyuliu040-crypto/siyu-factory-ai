import {
  AccountError,
  getUserBySessionToken,
  parseSessionCookie,
  toPublicUser,
  withAccountState
} from "@/lib/accounts";
import { accountErrorResponse } from "@/lib/account-api";

export const dynamic = "force-dynamic";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function dayKey(value: string | number | Date) {
  const time = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function isUsageDebit(reason: string) {
  const lower = reason.toLowerCase();
  return lower.includes("generation") || lower.includes("deepseek");
}

function isFailureRefund(reason: string) {
  return reason.toLowerCase().includes("refund");
}

export async function GET(request: Request) {
  try {
    const token = parseSessionCookie(request.headers.get("cookie"));
    if (!token) throw new AccountError("auth_required", "Please log in first.", 401);

    const result = await withAccountState((state) => {
      const admin = getUserBySessionToken(state, token);
      if (!admin || admin.role !== "admin") {
        throw new AccountError("admin_required", "Only admins can view usage.", 403);
      }

      const today = dayKey(new Date());
      const users = state.users.map((user) => {
        const ledger = state.ledger.filter((entry) => entry.userId === user.id && dayKey(entry.createdAt) === today);
        const tasks = state.generationTasks.filter((task) => task.userId === user.id && dayKey(task.createdAt) === today);
        const spent = ledger
          .filter((entry) => entry.amount < 0 && isUsageDebit(entry.reason))
          .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
        const refunded = ledger
          .filter((entry) => entry.amount > 0 && isFailureRefund(entry.reason))
          .reduce((sum, entry) => sum + entry.amount, 0);
        const adminAdded = ledger
          .filter((entry) => entry.amount > 0 && !isFailureRefund(entry.reason))
          .reduce((sum, entry) => sum + entry.amount, 0);
        const adminSubtracted = ledger
          .filter((entry) => entry.amount < 0 && !isUsageDebit(entry.reason))
          .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

        return {
          user: toPublicUser(user),
          date: today,
          spent,
          refunded,
          netSpent: Math.max(0, spent - refunded),
          adminAdded,
          adminSubtracted,
          tasks: {
            total: tasks.length,
            completed: tasks.filter((task) => task.status === "completed").length,
            failed: tasks.filter((task) => task.status === "failed").length,
            running: tasks.filter((task) => task.status === "queued" || task.status === "in_progress").length
          }
        };
      });

      return {
        date: today,
        users,
        totals: {
          spent: users.reduce((sum, item) => sum + item.spent, 0),
          refunded: users.reduce((sum, item) => sum + item.refunded, 0),
          netSpent: users.reduce((sum, item) => sum + item.netSpent, 0),
          tasks: users.reduce((sum, item) => sum + item.tasks.total, 0)
        }
      };
    });

    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
