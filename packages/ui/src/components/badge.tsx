import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-primary)] text-white",
        success: "bg-[var(--color-success)]/20 text-[var(--color-success)]",
        warning: "bg-[var(--color-warning)]/20 text-[var(--color-warning)]",
        danger:  "bg-[var(--color-danger)]/20 text-[var(--color-danger)]",
        outline: "border border-[var(--color-border)] text-[var(--color-text-muted)]",
        muted:   "bg-[var(--color-surface-raised)] text-[var(--color-text-muted)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
