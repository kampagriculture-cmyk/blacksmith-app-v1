import Link from "next/link";

export function BackLink({ href = "/", label = "หน้าแรก" }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink transition-colors mb-4"
    >
      ← {label}
    </Link>
  );
}
