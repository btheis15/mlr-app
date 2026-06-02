"use client";

import { useRef, useState } from "react";
import { AdminAlertComposer } from "@/components/AdminAlertComposer";
import { useIdentity } from "@/components/IdentityProvider";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { ComingSoonCTA } from "@/components/ComingSoonCTA";
import { DemoDateControl } from "@/components/DemoDateControl";
import { Avatar } from "@/components/Avatar";
import { AvatarCropper } from "@/components/AvatarCropper";
import { ContactPaySettings } from "@/components/ContactPaySettings";

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
          note="Sign-in, RSVP, chat, and shared photos land in the next update. For now, explore away."
        />
        <ul className="space-y-2 text-sm text-foreground/70">
          <li className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-border">
            <span className="text-lg">💬</span> Resort chat — read along today
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
            Add your name and email to post in chat, RSVP, and get alerts. Looking
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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-accent">Notifications</h2>
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
        <p className="px-1 text-xs text-foreground/40">
          Android push notifications can be enabled here once the backend is in
          place; on iOS, alerts come by email.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-accent">Contact &amp; payment</h2>
        <p className="px-1 text-xs text-foreground/50">
          Optional — this is what shows when someone taps your name to contact or pay you.
        </p>
        <ContactPaySettings />
      </section>

      {isAdmin && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-accent">Admin</h2>
          <AdminAlertComposer />
        </section>
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
