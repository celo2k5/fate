import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { LoginForm } from "./LoginForm";
export const dynamic = "force-dynamic";
export default async function AdminLogin() {
  if (await isAdmin()) redirect("/admin");
  return <LoginForm />;
}
