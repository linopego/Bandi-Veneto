import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Select nativo: i filtri della dashboard vivono nella querystring e vengono
 * inviati da un <form>, quindi non serve un componente controllato lato client.
 */
function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "border-input bg-background focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export { Select };
