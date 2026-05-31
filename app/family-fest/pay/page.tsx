import { PayView } from "@/components/PayView";
import { PAYEES } from "@/lib/data";

export default function PayPage() {
  return <PayView payees={PAYEES} />;
}
