import { cn } from "@/lib/utils";

export function Masthead({ className }: { className?: string }) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <header className={cn("masthead-rule py-6 mb-8", className)}>
      <div className="flex items-baseline justify-between gap-4 text-xs uppercase tracking-widest text-muted-foreground mb-3">
        <span>Vol. I · No. 01</span>
        <span className="hidden sm:inline">{today}</span>
        <span>Yangon Edition</span>
      </div>
      <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-black tracking-tight text-center leading-none">
        The Newsroom
      </h1>
      <p className="text-center mt-3 text-sm sm:text-base italic text-muted-foreground font-serif">
        An AI Studio for Myanmar Journalism — Drafting, Editing &amp; Publishing to International Standard
      </p>
    </header>
  );
}
