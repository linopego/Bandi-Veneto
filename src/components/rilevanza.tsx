import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Punteggio 0-5 come pallini: si legge a colpo d'occhio in una lista lunga. */
export function Rilevanza({
  valore,
  className,
}: {
  valore: number | null;
  className?: string;
}) {
  if (valore === null) {
    return (
      <span className={cn("text-muted-foreground text-xs", className)}>
        non valutato
      </span>
    );
  }
  const variant =
    valore >= 4 ? "success" : valore >= 3 ? "warning" : "secondary";
  return (
    <Badge variant={variant} className={cn("font-mono", className)}>
      {"●".repeat(valore)}
      {"○".repeat(5 - valore)} {valore}/5
    </Badge>
  );
}
