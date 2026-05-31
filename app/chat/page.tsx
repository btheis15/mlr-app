import { ChatView } from "@/components/ChatView";
import { SEED_CHAT } from "@/lib/data";

export default function ChatPage() {
  return <ChatView seed={SEED_CHAT} />;
}
