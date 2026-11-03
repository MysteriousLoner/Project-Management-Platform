import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { applicationUrl } from "./auth";
import { requirePrincipal } from "./auth-session";
import { ApiError } from "./api";
export async function pagePrincipal(path = "/") {
  try { return await requirePrincipal(new Request(`${applicationUrl}${path}`, { headers: await headers() })); }
  catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) redirect(`/sign-in?returnTo=${encodeURIComponent(path)}`);
    throw error;
  }
}
