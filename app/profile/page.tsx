"use client";

import { useRef, useState } from "react";
import { AdminAlertComposer } from "@/components/AdminAlertComposer";
import { EmailMembers } from "@/components/EmailMembers";
import { AdminMembers } from "@/components/AdminMembers";
import { AdminProfileOverride } from "@/components/AdminProfileOverride";
import { AdminCommittees } from "@/components/AdminCommittees";
import { AdminCabinBookings } from "@/components/AdminCabinBookings";
import { AdminSignins } from "@/components/AdminSignins";
import { PreviewAs } from "@/components/PreviewAs";
import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { DemoDateControl } from "@/components/DemoDateControl";
import { Avatar } from "@/components/Avatar";
import { AvatarCropper } from "@/components/AvatarCropper";
import { ContactPaySettings } from "@/components/ContactPaySettings";
import { ChangeEmail } from "@/components/ChangeEmail";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { PushToggle } from "@/components/PushToggle";
import { NotifPrefs } from "@/components/NotifPrefs";
import { AdminNotificationComposer } from "@/components/AdminNotificationComposer";

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
            className="press absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs text-white ring-2 ring-background disabled:opacity-50"
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
          <p className="truncate text-sm text-foreground/50">{user.email}</p>
        </div>
      </header>

      <ChangeEmail />

      <CollapsibleSection
        title="Notifications"
        icon="🔔"
        subtitle={
          user.pushTypes && user.pushTypes.length > 0
            ? "Push on"
            : user.emailAlerts
              ? "Email alerts on"
              : "Off"
        }
      >
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span className="min-w-0">
            <span className="text-sm font-medium">Email me alerts</span>
            <span className="block text-xs text-foreground/50">
              Get an email when an admin pushes an alert, in case you miss it in
              the app.
            </span>
          </span>
          <input
            type="checkbox"
            checked={user.emailAlerts}
            onChange={(e) => updateUser({ emailAlerts: e.target.checked })}
            className="h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
        </label>
        <PushToggle />
        <div className="mt-2 border-t border-border pt-3">
          <NotifPrefs />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Contact & payment"
        icon="💳"
        subtitle="Phone & pay handles for your member card"
      >
        <p className="px-1 text-xs text-foreground/50">
          Optional — this is what shows when someone taps your name to contact or pay you.
        </p>
        <ContactPaySettings />
      </CollapsibleSection>

      <CollapsibleSection
        title="Email members"
        icon="✉️"
        subtitle="A custom list, your committees, or everyone"
      >
        <EmailMembers />
      </CollapsibleSection>

      {isAdmin && (
        <>
          <h2 className="px-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-accent">🛠️ Admin tools</h2>
          <CollapsibleSection title="Post an alert" icon="📣" subtitle="Banner notice to everyone (+ email)">
            <AdminAlertComposer />
          </CollapsibleSection>
          <CollapsibleSection title="Send a notification" icon="🔔" subtitle="To everyone, beta testers, or admins · their Activity tab">
            <AdminNotificationComposer />
          </CollapsibleSection>
          <CollapsibleSection title="Committees" icon="👥" subtitle="Who's in each + join requests">
            <AdminCommittees />
          </CollapsibleSection>
          <CollapsibleSection title="Cabin Stays" icon="🏡" subtitle="Approve room requests">
            <AdminCabinBookings />
          </CollapsibleSection>
          <CollapsibleSection title="Members" icon="🧑‍🤝‍🧑" subtitle="Everyone signed in · make admins">
            <AdminMembers />
          </CollapsibleSection>
          <CollapsibleSection title="Edit a member's information" icon="✏️" subtitle="Two-admin unlock · backup for members">
            <AdminProfileOverride />
          </CollapsibleSection>
          <CollapsibleSection title="Recent activity" icon="🔐" subtitle="Who joined & recent sign-ins">
            <AdminSignins />
          </CollapsibleSection>
          <CollapsibleSection title="View as" icon="👁️" subtitle="Preview the app as a member or guest">
            <PreviewAs />
          </CollapsibleSection>
        </>
      )}

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
