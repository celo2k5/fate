import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { AdminConsole } from "./AdminConsole";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Fate" };
export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");
  return <AdminConsole />;
}
