import { requireUser } from "@/server/auth/session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Input } from "@/components/ui/form";
import { ActionForm, FormField, SubmitButton } from "@/components/ui/action-form";
import { changeOwnPasswordAction } from "@/server/actions/admin";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <div className="max-w-lg">
      <PageHeader title="Your account" description={`${user.name} · ${user.email} · ${user.role === "ADMIN" ? "Admin" : "Engineer"}`} />
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionForm action={changeOwnPasswordAction} resetOnSuccess className="space-y-3">
            <FormField name="password" label="New password" hint="At least 10 characters, with a letter and a number">
              <Input id="password" name="password" type="password" autoComplete="new-password" required />
            </FormField>
            <FormField name="confirm" label="Confirm new password">
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
            </FormField>
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </CardContent>
      </Card>
    </div>
  );
}
