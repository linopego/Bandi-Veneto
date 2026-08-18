import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Helper di composizione classi usato dai componenti in stile shadcn/ui. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
