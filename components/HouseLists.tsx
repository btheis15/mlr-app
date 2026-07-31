"use client";

import { useEffect, useRef, useState } from "react";
import type { HouseList, HouseListItem } from "@/lib/types";
import { listProgress, houseListsAvailable, type HouseListInput } from "@/lib/houseLists";
import { useHouseLists, useSheetDismiss, useSaveStatus } from "@/lib/hooks";
import { Sheet, SectionLabel, FIELD } from "@/components/Sheet";
import { SkeletonList } from "@/components/Skeleton";
import { MigrationHint } from "@/components/MigrationHint";

/** A few one-tap handles for the common kinds of list, so nobody has to hunt
 *  through an emoji keyboard. Any other emoji can still be typed in. */
const EMOJI_CHOICES = ["📝", "🛒", "✅", "🧰", "🎒", "🍽️", "🐟", "🔧"];

/**
 * A house's shared Lists (migration 0169). ONE flexible list shape — a title plus
 * items that can each be checked off — so a shopping list, a cabin close-up
 * checklist and a "stuff to fix" list are all the same thing, with no type to pick
 * at creation time.
 *
 * Everything here is shared: anyone in the house can start a list and add, check,
 * edit or delete ANY item on it (the RPCs gate on is_house_member, not on
 * authorship). That's deliberate — the person who gets the milk is rarely the
 * person who wrote it down. The house's *tracked* work lives in work items (0066).
 *
 * Checking an item paints instantly via a local override (`optimistic`) so a
 * checkbox never waits on a round-trip; Realtime keeps two people at the store in
 * sync. Newest list first; the top one starts expanded and the rest collapsed, so
 * a house with six lists doesn't open to a wall of items.
 */
export function HouseLists({ houseId }: { houseId: string }) {
  const {
    lists,
    loading,
    canWrite,
    addList,
    editList,
    removeList,
    addItem,
    editItem,
    setItemChecked,
    removeItem,
    clearChecked,
    uncheckAll,
  } = useHouseLists(houseId);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editingList, setEditingList] = useState<HouseList | null>(null);
  // Which lists are open. Seeded once from the first load (top list expanded);
  // after that it's purely what the member has tapped.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const seeded = useRef(false);
  // Pre-migration (0169 not applied) ⇒ say so instead of showing a silently
  // empty screen. Only checked when the load came back empty.
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (seeded.current || loading || lists.length === 0) return;
    seeded.current = true;
    setExpanded({ [lists[0].id]: true });
  }, [loading, lists]);

  useEffect(() => {
    if (loading || lists.length > 0) return;
    let alive = true;
    houseListsAvailable().then((ok) => {
      if (alive) setAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, [loading, lists.length]);

  const toggleExpanded = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  if (loading && lists.length === 0) return <SkeletonList />;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setComposerOpen(true)}
        className="press w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white"
      >
        + New list
      </button>

      {lists.length === 0 ? (
        <div className="space-y-3 rounded-2xl bg-card p-6 text-center ring-1 ring-border">
          <p className="text-3xl">📝</p>
          <div>
            <p className="text-sm font-semibold">No lists yet</p>
            <p className="mt-1 text-sm text-foreground/60">
              Start one for anything the house shares — the grocery run, what to pack, the close-up checklist.
              Everyone in the house can add to it.
            </p>
          </div>
          {!available && (
            <MigrationHint file="0169_house_lists.sql">Lists aren&rsquo;t set up on this backend yet —</MigrationHint>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {lists.map((list) => (
            <li key={list.id}>
              <ListCard
                list={list}
                open={!!expanded[list.id]}
                onToggleOpen={() => toggleExpanded(list.id)}
                canWrite={canWrite}
                onRename={() => setEditingList(list)}
                onDelete={async () => {
                  if (
                    !window.confirm(
                      `Delete "${list.title}"? This removes the list and its ${list.items.length} item${
                        list.items.length === 1 ? "" : "s"
                      } for the whole house.`,
                    )
                  )
                    return;
                  await removeList(list.id);
                }}
                onAddItem={(text) => addItem(list.id, text)}
                onEditItem={editItem}
                onCheckItem={setItemChecked}
                onDeleteItem={removeItem}
                onClearChecked={() => clearChecked(list.id)}
                onUncheckAll={() => uncheckAll(list.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {composerOpen && (
        <HouseListComposer
          onSave={async (input) => addList(input)}
          onClose={() => setComposerOpen(false)}
        />
      )}
      {editingList && (
        <HouseListComposer
          list={editingList}
          onSave={async (input) => editList(editingList.id, input)}
          onClose={() => setEditingList(null)}
        />
      )}
    </div>
  );
}

/** One list: a tappable header (emoji · title · progress) over its items, the
 *  add-item row, and the list-level actions. */
function ListCard({
  list,
  open,
  onToggleOpen,
  canWrite,
  onRename,
  onDelete,
  onAddItem,
  onEditItem,
  onCheckItem,
  onDeleteItem,
  onClearChecked,
  onUncheckAll,
}: {
  list: HouseList;
  open: boolean;
  onToggleOpen: () => void;
  canWrite: boolean;
  onRename: () => void;
  onDelete: () => void;
  onAddItem: (text: string) => Promise<{ error?: string }>;
  onEditItem: (id: string, text: string) => Promise<{ error?: string }>;
  onCheckItem: (id: string, checked: boolean) => Promise<{ error?: string }>;
  onDeleteItem: (id: string) => Promise<{ error?: string }>;
  onClearChecked: () => Promise<{ error?: string }>;
  onUncheckAll: () => Promise<{ error?: string }>;
}) {
  const { done, total } = listProgress(list);
  // Local overrides so a tapped checkbox flips instantly instead of waiting on
  // the RPC + reload. An entry is dropped as soon as its write settles (the hook
  // reloads before resolving, so server truth has landed by then).
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const isChecked = (item: HouseListItem) => optimistic[item.id] ?? !!item.checkedAt;
  const shownDone = list.items.filter(isChecked).length;

  async function check(item: HouseListItem, next: boolean) {
    setOptimistic((o) => ({ ...o, [item.id]: next }));
    const res = await onCheckItem(item.id, next);
    setOptimistic((o) => {
      const { [item.id]: _dropped, ...rest } = o;
      return rest;
    });
    setError(res.error ?? null);
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
      <button
        type="button"
        onClick={onToggleOpen}
        aria-expanded={open}
        className="press flex w-full items-center gap-3 p-4 text-left"
      >
        <span
          aria-hidden
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-2xl"
        >
          {list.emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{list.title}</span>
          <span className="mt-0.5 block truncate text-xs text-foreground/60">
            {total === 0
              ? "Empty — add the first item"
              : shownDone === total
                ? `All ${total} done`
                : `${shownDone} of ${total} done`}
            {list.note ? ` · ${list.note}` : ""}
          </span>
        </span>
        {total > 0 && (
          <span
            className="shrink-0 text-xs font-semibold tabular-nums text-foreground/50"
            aria-hidden
          >
            {shownDone}/{total}
          </span>
        )}
        <span className="shrink-0 text-lg leading-none text-foreground/40" aria-hidden>
          {open ? "⌃" : "⌄"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-1">
          {list.items.length > 0 && (
            <ul className="divide-y divide-border/60">
              {list.items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  checked={isChecked(item)}
                  onCheck={(next) => check(item, next)}
                  onEdit={(text) => onEditItem(item.id, text)}
                  onDelete={() => onDeleteItem(item.id)}
                />
              ))}
            </ul>
          )}

          <AddItemRow onAdd={onAddItem} disabled={!canWrite} />

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3">
            {done > 0 && (
              <>
                <ActionLink
                  label={`Clear ${done} checked`}
                  onClick={async () => {
                    if (!window.confirm(`Remove the ${done} checked item${done === 1 ? "" : "s"} from "${list.title}"?`))
                      return;
                    const res = await onClearChecked();
                    setError(res.error ?? null);
                  }}
                />
                <ActionLink
                  label="Uncheck all"
                  onClick={async () => {
                    const res = await onUncheckAll();
                    setError(res.error ?? null);
                  }}
                />
              </>
            )}
            <ActionLink label="Rename" onClick={onRename} />
            <ActionLink label="Delete list" onClick={onDelete} danger />
            <span className="ml-auto text-xs text-faint">Started by {list.authorName}</span>
          </div>
        </div>
      )}
    </section>
  );
}

/** One item: a checkbox, its text (tap to edit), and a delete button. Checked
 *  items dim + strike through and show who got it. */
function ItemRow({
  item,
  checked,
  onCheck,
  onEdit,
  onDelete,
}: {
  item: HouseListItem;
  checked: boolean;
  onCheck: (next: boolean) => void;
  onEdit: (text: string) => Promise<{ error?: string }>;
  onDelete: () => Promise<{ error?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [saving, setSaving] = useState(false);

  async function save() {
    const text = draft.trim();
    if (!text || text === item.text) {
      setEditing(false);
      setDraft(item.text);
      return;
    }
    setSaving(true);
    const res = await onEdit(text);
    setSaving(false);
    if (!res.error) setEditing(false);
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 py-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
            if (e.key === "Escape") {
              setEditing(false);
              setDraft(item.text);
            }
          }}
          onBlur={save}
          disabled={saving}
          className={`min-w-0 flex-1 ${FIELD}`}
          aria-label="Item text"
        />
        <button type="button" onClick={save} disabled={saving} className="press text-sm font-semibold text-primary">
          Save
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onCheck(!checked)}
        className={`press flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ring-1 transition-colors ${
          checked ? "bg-primary text-white ring-primary" : "bg-background text-transparent ring-border"
        }`}
      >
        ✓
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(item.text);
          setEditing(true);
        }}
        className="min-w-0 flex-1 text-left"
      >
        <span className={`block break-words text-sm ${checked ? "text-foreground/40 line-through" : ""}`}>
          {item.text}
        </span>
        {checked && item.checkedByName && (
          <span className="mt-0.5 block text-xs text-faint">Got by {item.checkedByName}</span>
        )}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${item.text}`}
        className="press shrink-0 rounded-full px-2 py-1 text-sm text-faint hover:text-foreground"
      >
        ✕
      </button>
    </li>
  );
}

/** The always-present "add an item" row. Keeps focus after each add so a whole
 *  grocery run can be typed in without reaching for the field again. */
function AddItemRow({
  onAdd,
  disabled,
}: {
  onAdd: (text: string) => Promise<{ error?: string }>;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    // Clear optimistically so the next item can be typed immediately; restore
    // the text if the write failed so nothing is silently lost.
    setText("");
    const res = await onAdd(value);
    setBusy(false);
    if (res.error) {
      setText(value);
      setError(res.error);
    } else {
      setError(null);
    }
    input.current?.focus();
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Add an item…"
          aria-label="Add an item"
          className={`min-w-0 flex-1 ${FIELD}`}
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !text.trim() || busy}
          className="press shrink-0 rounded-full bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ActionLink({
  label,
  onClick,
  danger = false,
}: {
  label: string;
  onClick: () => void | Promise<void>;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press text-xs font-semibold ${danger ? "text-red-600" : "text-primary"}`}
    >
      {label}
    </button>
  );
}

/** Start a new list, or rename an existing one. Title + a one-tap emoji handle +
 *  an optional line of context. */
function HouseListComposer({
  list,
  onSave,
  onClose,
}: {
  list?: HouseList | null;
  onSave: (input: HouseListInput) => Promise<{ error?: string }>;
  onClose: () => void;
}) {
  const { closing, close } = useSheetDismiss(onClose);
  const { pending, status, run } = useSaveStatus();
  const editing = !!list;
  const [title, setTitle] = useState(list?.title ?? "");
  const [emoji, setEmoji] = useState(list?.emoji ?? "📝");
  const [note, setNote] = useState(list?.note ?? "");

  const submit = () =>
    run(async () => {
      if (!title.trim()) return "Give the list a name.";
      const res = await onSave({ title: title.trim(), emoji, note: note.trim() || null });
      if (res.error) return res.error;
      close();
      return null;
    });

  return (
    <Sheet
      closing={closing}
      onDismiss={close}
      labelledBy="house-list-composer-title"
      header={
        <div className="pb-3">
          <h2 id="house-list-composer-title" className="text-lg font-bold">
            {editing ? "Rename list" : "New list"}
          </h2>
          <p className="mt-0.5 text-sm text-foreground/60">
            Anyone in the house can add to it and check things off.
          </p>
        </div>
      }
      footer={
        <div className="flex items-center gap-3">
          {status && <p className="min-w-0 flex-1 truncate text-xs text-foreground/70">{status}</p>}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="press ml-auto rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? "Saving…" : editing ? "Save" : "Create list"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <SectionLabel>Name</SectionLabel>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Groceries, Close-up checklist, What to pack…"
            className={`w-full ${FIELD}`}
          />
        </div>

        <div className="space-y-1.5">
          <SectionLabel>Icon</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-pressed={emoji === e}
                className={`press flex h-10 w-10 items-center justify-center rounded-xl text-xl ring-1 ${
                  emoji === e ? "bg-primary/12 ring-primary" : "bg-card ring-border"
                }`}
              >
                {e}
              </button>
            ))}
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              aria-label="Custom icon"
              className="h-10 w-14 rounded-xl bg-card text-center text-xl ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <SectionLabel>Note (optional)</SectionLabel>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="For the 4th of July weekend"
            className={`w-full ${FIELD}`}
          />
        </div>
      </div>
    </Sheet>
  );
}
