import { headers } from "next/headers";

export async function currentEmail(): Promise<string> {
  const h = await headers();
  const email = h.get("x-user-email");
  if (!email) throw new Error("No authenticated user");
  return email.toLowerCase();
}
