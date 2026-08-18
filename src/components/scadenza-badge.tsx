import { Badge } from "@/components/ui/badge";
import { etichettaScadenza, formatData, giorniAllaScadenza } from "@/lib/format";

/** Data di scadenza più l'urgenza, con il colore che segue i giorni mancanti. */
export function ScadenzaBadge({ scadenza }: { scadenza: Date | null }) {
  const giorni = giorniAllaScadenza(scadenza);
  if (giorni === null) {
    return <span className="text-muted-foreground text-sm">senza scadenza</span>;
  }
  const variant =
    giorni < 0 ? "outline" : giorni <= 7 ? "destructive" : giorni <= 15 ? "warning" : "secondary";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">{formatData(scadenza)}</span>
      <Badge variant={variant} className="w-fit">
        {etichettaScadenza(scadenza)}
      </Badge>
    </div>
  );
}
