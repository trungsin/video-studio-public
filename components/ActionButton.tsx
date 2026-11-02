"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Nút gọi API (POST/PATCH) rồi refresh trang; hiện lỗi nếu có. */
export default function ActionButton({ url, method = "POST", body, children, className = "btn", confirmText, onDoneHref }: { url: string; method?: string; body?: unknown; children: React.ReactNode; className?: string; confirmText?: string; onDoneHref?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={className}
      disabled={busy}
      onClick={async () => {
        if (confirmText && !confirm(confirmText)) return;
        setBusy(true);
        try {
          const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) alert(j.error || `Lỗi ${r.status}`);
          else if (onDoneHref) router.push(onDoneHref.replace(":id", j.id || ""));
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "…" : children}
    </button>
  );
}
