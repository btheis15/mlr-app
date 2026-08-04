import { CommitteeChatRoute } from "@/components/CommitteeChatRoute";
import { committeeSlugParams } from "@/lib/committeeParams";

// The committee's private Leads chat (the reserved `Leads` channel, migration
// 0172) as a REAL PRERENDERED ROUTE, not `/chat?area=Leads`.
//
// Why a whole route instead of a query param: in the INSTALLED PWA (macOS dock
// / iOS home screen), tapping a link to a static route carrying a query string
// failed with WebKit's own "This page couldn't load" page — the navigation died
// in the app container before React ever ran, so nothing in the app could catch
// or report it. Every other link in this app is a bare path, which is exactly
// why nothing else hit this. Making the channel part of the PATH keeps the Leads
// room a plain static navigation like all the rest.
//
// Same params/dynamicParams as the sibling /chat route, so an admin-created
// committee gets a prerendered Leads page too and brand-new slugs still serve.
export const dynamicParams = true;
export async function generateStaticParams() {
  return committeeSlugParams();
}

export default async function CommitteeLeadsChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CommitteeChatRoute slug={slug} area="Leads" />;
}
