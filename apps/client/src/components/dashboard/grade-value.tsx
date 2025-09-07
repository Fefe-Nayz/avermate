import NumberTicker from "@/components/ui/number-ticker";
import { cn } from "@/lib/utils";
import { formatGradeValue } from "@/utils/format";

export default function GradeValue({
  value,
  outOf,
  size = "xl",
  duration = 2,
  triggerOnView = false
}: {
  value: number;
  outOf: number;
  size?: "sm" | "xl";
  duration?: number;
  triggerOnView?: boolean;
}) {
  //const decimals = formatGradeValue(value).toString().split(".")[1]?.length || 0;
  return (
    <div className="flex items-center gap-1 whitespace-nowrap">
      <p
        className={cn(
          size === "sm" && "text-lg font-normal",
          size === "xl" && "text-xl md:text-3xl font-bold"
        )}
      >
        <NumberTicker
          decimalPlaces={2}
          value={formatGradeValue(value)}
          duration={duration}
          triggerOnView={triggerOnView}
        />

        <span
          className={cn(
            "text-sm text-muted-foreground align-sub",
            size === "sm" && "text-xs"
          )}
        >
          /{formatGradeValue(outOf)}
        </span>
      </p>
    </div>
  );
}
