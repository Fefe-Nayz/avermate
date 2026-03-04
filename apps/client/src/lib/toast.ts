import { toast as sonnerToast } from "sonner";

import { triggerHaptic } from "@/lib/haptics";

const toast = Object.assign(
  (...args: Parameters<typeof sonnerToast>) => sonnerToast(...args),
  sonnerToast,
  {
    success: (...args: Parameters<typeof sonnerToast.success>) => {
      triggerHaptic("success");
      return sonnerToast.success(...args);
    },
    error: (...args: Parameters<typeof sonnerToast.error>) => {
      triggerHaptic("error");
      return sonnerToast.error(...args);
    },
    warning: (...args: Parameters<typeof sonnerToast.warning>) => {
      triggerHaptic("warning");
      return sonnerToast.warning(...args);
    },
  }
);

export { toast };
