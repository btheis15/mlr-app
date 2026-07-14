"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { DemoDateControl } from "@/components/DemoDateControl";
import { Avatar } from "@/components/Avatar";
import { AvatarCropper } from "@/components/AvatarCropper";
import { ContactPaySettings } from "@/components/ContactPaySettings";
import { ChangeEmail } from "@/components/ChangeEmail";
import { EditDisplayName } from "@/components/EditDisplayName";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { PushToggle } from "@/components/PushToggle";
import { NotifPrefs } from "@/components/NotifPrefs";
import { InstallButton } from "@/components/InstallButton";
import { TextSizeControl } from "@/components/TextSizeControl";
import { WillingToHelpToggle } from "@/components/WillingToHelpToggle";
import { SettingsGroup } from "@/components/SettingsGroup";
import { SettingsRow, SettingsToggleRow } from "@/components/SettingsRow";

export default function ProfilePage() {
  const { user, isAdmin, updateUser, promptSignIn, signOut } = useIdentity();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const onPickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) setCropFile(file); // open the cropper; upload happens on "Use photo"
  };

  const handleCropped = async (out: File) => {
    setCropFile(null);
    if (!supabase) return;
    setUploading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const id = sess.session?.user.id;
      if (!id) throw new Error("Not signed in");
      const path = `${id}/${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("avatars").upload(path, out, { contentType: "image/jpeg", upsert: true });
      if (error) throw error;
      updateUser({ avatarUrl: supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl });
    } catch {
      /* keep the old photo on any hiccup */
    } finally {
      setUploading(false);
    }
  };

  // Sign-in goes live once the backend is configured (NEXT-STEPS.md §3b).
  // Until then, browsing stays fully open and this shows a "coming soon".
  if (!isSupabaseConfigured) {
    return (
      <div className="space-y-4 pt-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-sm text-foreground/60">
            Everything here is open to browse — no account needed.
          </p>
        </header>
        <ComingSoonCTA
          icon="👋"
          title="Member profiles are coming soon"
          note="Sign-in, RSVP, committee chat, and shared photos land in the next update. For now, explore away."
        />
        <ul className="space-y-2 text-sm text-foreground/70">
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">💬</span> Committee chats — a private room per group
          </li>
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">🎉</span> Family Fest — schedule, crew &amp; photos
          </li>
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">🔔</span> Alerts &amp; RSVP — once sign-in is live
          </li>
        </ul>

        <InstallButton />

        <Link
          href="/help"
          className="press flex items-center justify-between rounded-2xl bg-card p-4 ring-1 ring-border"
        >
          <span className="flex items-center gap-3 text-sm font-medium">
            <span className="text-lg" aria-hidden>❓</span> Help &amp; how-to
          </span>
          <span className="text-foreground/40" aria-hidden>›</span>
        </Link>

        <DemoDateControl />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4 pt-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
          <p className="text-sm text-foreground/60">
            You&rsquo;re browsing as a guest.
          </p>
        </header>
        <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          <p className="text-sm text-foreground/70">
            Add your name and email to post, RSVP, and get alerts. Looking
            around stays open to everyone.
          </p>
          <button
            onClick={promptSignIn}
            className="press w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white"
          >
            Add your name &amp; email
          </button>
        </div>

        <InstallButton />

        <Link
          href="/help"
          className="press flex items-center justify-between rounded-2xl bg-card p-4 ring-1 ring-border"
        >
          <span className="flex items-center gap-3 text-sm font-medium">
            <span className="text-lg" aria-hidden>❓</span> Help &amp; how-to
          </span>
          <span className="text-foreground/40" aria-hidden>›</span>
        </Link>

        <DemoDateControl />
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-6">
      <header className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar name={user.name} url={user.avatarUrl} size={64} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="press absolute -bottom-1.5 -right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm text-white ring-2 ring-background disabled:opacity-50"
            aria-label="Change profile photo"
          >
            {uploading ? "…" : "📷"}
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickPhoto} className="hidden" />
        </div>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <span className="truncate">{user.name}</span>
            {isAdmin && (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
                Admin
              </span>
            )}
          </h1>
          <p className="truncate text-sm text-muted">{user.email}</p>
        </div>
      </header>

      <SettingsGroup title="Account">
        <EditDisplayName />
        <ChangeEmail />
      </SettingsGroup>

      <SettingsGroup title="Notifications">
        <CollapsibleSection
          bare
          title="Activity notifications"
          icon="🔔"
          subtitle="What lands in your Activity tab"
        >
          <NotifPrefs />
        </CollapsibleSection>

        <CollapsibleSection
          bare
          title="Push notifications"
          icon="📲"
          subtitle={user.pushTypes && user.pushTypes.length > 0 ? "On — buzzes this phone" : "Off"}
        >
          <PushToggle />
        </CollapsibleSection>

        <SettingsToggleRow
          icon="✉️"
          title="Email me alerts"
          subtitle="Get an email when an admin pushes an alert, in case you miss it in the app."
          on={user.emailAlerts}
          onToggle={() => updateUser({ emailAlerts: !user.emailAlerts })}
        />
      </SettingsGroup>

      <SettingsGroup title="Payments">
        <CollapsibleSection
          bare
          title="Contact & payment"
          icon="💳"
          subtitle="Optional — what shows when someone taps your name to contact or pay you"
        >
          <ContactPaySettings />
        </CollapsibleSection>
      </SettingsGroup>

      <SettingsGroup title="Ask for Help">
        <WillingToHelpToggle />
        <SettingsRow icon="🙌" title="Ask for Help log" href="/help-requests" />
      </SettingsGroup>

      <section className="space-y-2">
        <p className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Text size
        </p>
        <TextSizeControl />
      </section>

      <InstallButton />

      <SettingsGroup title="More">
        {isAdmin && (
          <SettingsRow
            icon="🛠"
            title="Admin dashboard"
            subtitle="Manage members, alerts, content & more"
            href="/admin"
          />
        )}
        <SettingsRow icon="❓" title="Help & how-to" href="/help" />
      </SettingsGroup>

      <DemoDateControl />

      <button
        onClick={signOut}
        className="press w-full rounded-2xl bg-card py-3 text-sm font-semibold text-foreground/70 ring-1 ring-border"
      >
        Sign out
      </button>

      {cropFile && <AvatarCropper key={cropFile.name + cropFile.lastModified} file={cropFile} onCancel={() => setCropFile(null)} onSave={handleCropped} />}
    </div>
  );
}
