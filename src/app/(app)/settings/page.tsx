import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { getSetting, WHATSAPP_EVENT_TYPES } from "@/server/settings";
import { whatsAppStatus } from "@/server/integrations/whatsapp";
import { emailStatus } from "@/server/integrations/email";
import { storageStatus } from "@/server/integrations/storage";
import { gmailOAuthConfigured } from "@/server/integrations/gmail/oauth";
import { buildSearchQuery } from "@/server/integrations/gmail/sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, DefinitionList, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { buttonVariants } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-form";
import { CompanyForm, EmailForm, GmailRulesForm, MoveButtons, StageDialog, WhatsAppForm } from "@/components/admin/settings-forms";
import { UserDialog, ToggleActive } from "@/components/admin/user-dialog";
import * as S from "@/server/actions/admin";
import { cn, formatDateTime, formatRelative } from "@/lib/utils";

export const metadata = { title: "Settings" };

const TABS = [
  ["company", "Company"],
  ["gmail", "Gmail"],
  ["whatsapp", "WhatsApp"],
  ["email", "Email"],
  ["assembly", "Assembly stages"],
  ["users", "Users"],
  ["storage", "Storage"],
] as const;

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <Badge tone={ok ? "success" : "warning"}>{label}</Badge>;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; gmail?: string; reason?: string }> }) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab ?? "company";
  const e = env();

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4" aria-label="Settings sections">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/settings?tab=${k}`} className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", tab === k ? "border-primary font-medium" : "border-transparent text-muted hover:text-foreground")}>
            {l}
          </Link>
        ))}
      </nav>

      {tab === "company" && (
        <Card>
          <CardContent>
            <CompanyForm action={S.saveSettingsAction.bind(null, "company")} v={await getSetting("company")} />
          </CardContent>
        </Card>
      )}

      {tab === "gmail" && <GmailTab sp={sp} />}

      {tab === "whatsapp" && (
        <Card>
          <CardHeader>
            <CardTitle>WhatsApp notifications</CardTitle>
            {(() => {
              const s = whatsAppStatus();
              return <Status ok={s.configured} label={s.configured ? `Provider: ${s.provider}` : "Not configured"} />;
            })()}
          </CardHeader>
          <CardContent className="space-y-4">
            {!whatsAppStatus().configured && (
              <Alert tone="warning" title="WhatsApp provider is not configured">
                {whatsAppStatus().problem} Set <code>WHATSAPP_PROVIDER</code> (meta or twilio) and its credentials in the server environment — see README → WhatsApp setup. Until then notifications are recorded as “skipped” in the delivery log.
              </Alert>
            )}
            <p className="text-sm text-muted">Provider and credentials are configured on the server (never in the browser). Business-initiated Meta messages outside the 24-hour window require an approved template ({e.WHATSAPP_TEMPLATE_NAME ? `using “${e.WHATSAPP_TEMPLATE_NAME}”` : "WHATSAPP_TEMPLATE_NAME not set"}).</p>
            <WhatsAppForm action={S.saveSettingsAction.bind(null, "whatsapp")} v={await getSetting("whatsapp")} types={WHATSAPP_EVENT_TYPES} test={S.sendTestNotificationAction.bind(null, "WHATSAPP")} />
          </CardContent>
        </Card>
      )}

      {tab === "email" && (
        <Card>
          <CardHeader>
            <CardTitle>Completion emails</CardTitle>
            {(() => {
              const s = emailStatus();
              return <Status ok={s.configured} label={s.configured ? `Transport: ${s.provider}` : "Not configured"} />;
            })()}
          </CardHeader>
          <CardContent className="space-y-4">
            {!emailStatus().configured && <Alert tone="warning" title="Outgoing email is not configured">{emailStatus().problem} Set EMAIL_PROVIDER and SMTP_* (or use the connected Gmail account with EMAIL_PROVIDER=gmail).</Alert>}
            <EmailForm action={S.saveSettingsAction.bind(null, "email")} v={await getSetting("email")} test={S.sendTestNotificationAction.bind(null, "EMAIL")} />
          </CardContent>
        </Card>
      )}

      {tab === "assembly" && <StagesTab />}
      {tab === "users" && <UsersTab meId={me.id} />}

      {tab === "storage" && (
        <Card>
          <CardHeader>
            <CardTitle>File storage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(() => {
              const s = storageStatus();
              return (
                <>
                  <DefinitionList items={[["Provider", s.provider], ["Status", <Status key="s" ok={s.configured} label={s.configured ? "Configured" : "Not configured"} />], ["Details", s.detail], ["Max upload size", `${e.MAX_UPLOAD_MB} MB per file`]]} />
                  {e.STORAGE_PROVIDER === "local" && <Alert tone="warning">Local disk storage is for development only. Use S3, Cloudflare R2 or Supabase Storage in production (STORAGE_PROVIDER=s3).</Alert>}
                </>
              );
            })()}
            <p className="text-sm text-muted">All files are private. Downloads are authorised by the application and served via short-lived signed URLs.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function GmailTab({ sp }: { sp: { gmail?: string; reason?: string } }) {
  const [conn, rules, processed] = await Promise.all([
    prisma.gmailConnection.findUnique({ where: { id: "primary" } }),
    getSetting("gmail"),
    prisma.gmailProcessedMessage.count(),
  ]);
  const e = env();
  const configured = gmailOAuthConfigured();
  return (
    <div className="space-y-4">
      {sp.gmail === "connected" && <Alert tone="success">Gmail connected. New POs will be imported automatically.</Alert>}
      {sp.gmail === "error" && <Alert tone="danger" title="Gmail connection failed">{sp.reason ?? "Unknown error"}</Alert>}
      {sp.gmail === "not-configured" && <Alert tone="warning">Google OAuth credentials are not configured on the server.</Alert>}
      <Card>
        <CardHeader>
          <CardTitle>Connected account</CardTitle>
          <Status ok={conn?.status === "CONNECTED"} label={conn ? conn.status : "Not connected"} />
        </CardHeader>
        <CardContent className="space-y-4">
          {!configured && (
            <Alert tone="warning" title="Google OAuth is not configured">
              Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and ENCRYPTION_KEY on the server — see README → Gmail setup.
            </Alert>
          )}
          {conn ? (
            <DefinitionList
              items={[
                ["Mailbox", conn.email],
                ["Status", conn.status === "ERROR" ? <span className="text-[var(--tone-danger-fg)]">{conn.lastError}</span> : "Connected"],
                ["Last checked", `${formatDateTime(conn.lastSyncAt)} (${formatRelative(conn.lastSyncAt)})`],
                ["Messages examined", processed],
                ["Push notifications", conn.watchExpiration && conn.watchExpiration > new Date() ? `Active until ${formatDateTime(conn.watchExpiration)}` : e.GMAIL_PUBSUB_TOPIC ? "Configured — renews automatically" : "Off (polling only)"],
                ["Polling interval", `${e.GMAIL_POLL_INTERVAL_MINUTES} minutes (background worker)`],
              ]}
            />
          ) : (
            <p className="text-sm text-muted">Connect the company mailbox that receives purchase orders. Access uses Google OAuth 2.0 — no password is stored. Scopes: read mail, and send mail (for completion emails when EMAIL_PROVIDER=gmail).</p>
          )}
          <div className="flex flex-wrap gap-2">
            {configured && (
              <a href="/api/integrations/gmail/connect" className={buttonVariants({ variant: conn ? "secondary" : "primary" })}>
                {conn ? "Reconnect Gmail" : "Connect Gmail"}
              </a>
            )}
            {conn && (
              <>
                <ActionButton variant="secondary" run={S.syncGmailNowAction}>
                  Check for new POs now
                </ActionButton>
                <ActionButton variant="ghost" run={S.disconnectGmailAction} confirm="Disconnect Gmail? PO import will stop.">
                  Disconnect
                </ActionButton>
              </>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>PO detection rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <GmailRulesForm action={S.saveSettingsAction.bind(null, "gmail")} v={rules} />
          <div className="text-xs text-muted">
            Current Gmail search: <code className="rounded bg-surface-2 px-1.5 py-0.5">{buildSearchQuery(rules)}</code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

async function StagesTab() {
  const stages = await prisma.assemblyStage.findMany({ orderBy: { sequence: "asc" }, include: { _count: { select: { currentOrders: true } } } });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Assembly stages</CardTitle>
        <StageDialog action={S.saveStageAction.bind(null, null)} trigger="Add stage" />
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Stage</Th>
            <Th>Phase</Th>
            <Th className="text-right">Suggested %</Th>
            <Th className="text-right">Orders at stage</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {stages.map((s, i) => (
            <tr key={s.id} className={s.active ? "" : "opacity-60"}>
              <Td className="tabular">{i + 1}</Td>
              <Td className="font-medium">{s.name}</Td>
              <Td className="text-xs">{s.phase}</Td>
              <Td className="tabular text-right">{s.defaultProgress}%</Td>
              <Td className="tabular text-right">{s._count.currentOrders}</Td>
              <Td>
                <Badge tone={s.active ? "success" : "muted"}>{s.active ? "Active" : "Inactive"}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-right">
                <MoveButtons up={i > 0 ? S.moveStageAction.bind(null, s.id, "up") : undefined} down={i < stages.length - 1 ? S.moveStageAction.bind(null, s.id, "down") : undefined} />
                <StageDialog action={S.saveStageAction.bind(null, s.id)} trigger="Edit" v={{ name: s.name, phase: s.phase, defaultProgress: s.defaultProgress, active: s.active }} />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function UsersTab({ meId }: { meId: string }) {
  const users = await prisma.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <UserDialog action={S.saveUserAction.bind(null, null)} trigger="Add user" isNew />
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Email</Th>
            <Th>Phone</Th>
            <Th>Role</Th>
            <Th>Last login</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium">
                {u.name} {u.isDemo && <Badge tone="muted">Demo</Badge>}
              </Td>
              <Td>{u.email}</Td>
              <Td>{u.phone ?? "—"}</Td>
              <Td>
                <Badge tone={u.role === "ADMIN" ? "accent" : "info"}>{u.role}</Badge>
              </Td>
              <Td className="text-muted">{formatRelative(u.lastLoginAt)}</Td>
              <Td>
                <Badge tone={u.active ? "success" : "muted"}>{u.active ? "Active" : "Inactive"}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-right">
                <UserDialog action={S.saveUserAction.bind(null, u.id)} trigger="Edit" values={{ name: u.name, email: u.email, phone: u.phone, role: u.role }} />
                {u.id !== meId && <ToggleActive run={S.setUserActiveAction.bind(null, u.id, !u.active)} active={u.active} />}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
