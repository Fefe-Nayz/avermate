import { AdminGate } from "@/components/admin/admin-gate";
import { AdminSocialOverviewScreen } from "@/components/admin/admin-social-overview";

export default function AdminSocialIndex() {
  return (
    <AdminGate>
      <AdminSocialOverviewScreen />
    </AdminGate>
  );
}
