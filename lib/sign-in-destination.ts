/** Password-change return links must stay within this application. */
export function localDestination(value: string, origin: string) {
  try {
    const url = new URL(value, origin);
    if (url.origin === new URL(origin).origin && !value.includes("\\")) return `${url.pathname}${url.search}${url.hash}`;
  } catch { /* Fall back to the workspace. */ }
  return "/";
}

export function signInDestination(usingInitialPassword: boolean, next: string, origin: string, passwordPath = "/password") {
  if (!usingInitialPassword) return next;
  return `${passwordPath}?firstLogin=1&returnTo=${encodeURIComponent(localDestination(next, origin))}`;
}
