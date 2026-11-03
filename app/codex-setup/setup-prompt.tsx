"use client";
import { useState } from "react";
export default function SetupPrompt({ prompt }: { prompt: string }) {
  const [notice, setNotice] = useState("");
  return <><label className="sr-only" htmlFor="codex-setup-prompt">Codex setup prompt</label><textarea id="codex-setup-prompt" className="setup-prompt" readOnly value={prompt} onFocus={(e) => e.currentTarget.select()} spellCheck={false} /><button className="button button-primary" onClick={async () => { try { await navigator.clipboard.writeText(prompt); setNotice("Setup prompt copied."); } catch { setNotice("Select and copy the prompt above."); } }}>Copy setup prompt</button><span role="status" className="copy-notice">{notice}</span></>;
}
