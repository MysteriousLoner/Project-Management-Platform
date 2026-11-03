import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type { Principal } from "@/lib/knowledge-types";
import { appPath } from "@/lib/base-path";
import SignOut from "./sign-out";
export default function WorkspaceFrame({ principal, current, title, description, children }: { principal: Principal; current: string; title: string; description: string; children: ReactNode }) {
  const links = [["/", "Ticket tracker"], ["/reports", "Work reports"], ["/codex-setup", "Connect Codex"], ["/accounts", "People & access"], ["/password", "Your password"]];
  return <div className="app-shell"><aside className="sidebar"><Link className="brand" href={appPath("/")}><Image className="brand-app-icon" src={appPath("/icons/icon-192.png")} width={34} height={34} unoptimized alt="" /><span>协策达</span></Link><nav className="nav-list workspace-navigation" aria-label="Workspace navigation">{links.map(([href, label]) => <Link key={href} className={current === href ? "nav-active" : ""} href={appPath(href)}>{label}</Link>)}</nav><div className="sidebar-footer"><strong>{principal.displayName}</strong><SignOut /></div></aside><main className="main-content global-content"><header className="global-header"><div><h1>{title}</h1><p className="muted">{description}</p></div></header>{principal.usingInitialPassword && current !== "/password" && <p className="alert no-print">Your account is using the initial workspace password. <Link href={appPath("/password")}>Change your password</Link></p>}{children}</main></div>;
}
