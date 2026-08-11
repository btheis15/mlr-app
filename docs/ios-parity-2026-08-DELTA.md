# iOS ⇄ web delta — implementation checklist

**407 items.** One line each, grouped by area in build order. This is the *lean* view for planning and for feeding to an implementing agent.

⚠️ **Every warning, RPC signature, Codable shape and gotcha lives in the linked area doc — not here.** Open the area doc for the one feature you're building; there are **2,345 recorded warnings** in there and they're the difference between a two-hour port and a two-day one.

Full prose + Swift: [`ios-parity-2026-08.md`](ios-parity-2026-08.md) · machine-readable: [`ios-parity-2026-08.json`](ios-parity-2026-08.json)

**ADD** = iOS doesn't have it · **FINISH** = partly there, verify in the iOS repo · **AUDIT** = iOS has a version, the web one grew · 🚨 = true blocker

## 🚨 First — the 5 true blockers

1. **Photos actually loading (signed media reads)** (½d) — Every photo in the Feed 403s under MEDIA_AUTH=on. This is why enforcement is currently held at `report`. → [`07-posts-feed-depth-audit.md`](ios-parity-2026-08/07-posts-feed-depth-audit.md)
1. **Chat photos and videos actually load** (½d) — Same root cause for chat bubbles — an unsigned read is rejected regardless of surface. → [`08-chat-depth-audit.md`](ios-parity-2026-08/08-chat-depth-audit.md)
1. **Guest / waiting-to-be-approved / member gating** (1-2d) — An unverified member currently gets a member layout full of empty lists with no explanation. They are locked out and cannot tell why. → [`17-cross-cutting.md`](ios-parity-2026-08/17-cross-cutting.md)
1. **APNs device token registration** (½d) — Without a registered token the device receives nothing — every other notification feature is inert. → [`11-notifications-and-push.md`](ios-parity-2026-08/11-notifications-and-push.md)
1. **Signing out leaves nothing behind** (¼d) — A shared iPad leaks the previous member's cached content to the next. Security, not polish. → [`17-cross-cutting.md`](ios-parity-2026-08/17-cross-cutting.md)

**299 ADD · 76 FINISH · 32 AUDIT**


## Drop Boxes (shared downloadable albums)
[`01-drop-boxes.md`](ios-parity-2026-08/01-drop-boxes.md) · 26 items · 168 warnings in the doc

- [ ] `ADD` `½d` **Photos actually load (signed media links)** — Every photo and video request carries a short-lived signed token, so albums render instead of showing rows of broken tiles once the server starts enforcing it.
- [ ] `ADD` `½d` **"Waiting for an admin to verify you"** — A brand-new member who hasn't been verified by an admin yet is told they're waiting for approval, instead of being shown an empty album screen that looks broken. · `is_approved_member`
- [ ] `ADD` `½d` **Albums fill in live** — New photos and new albums appear on their own while you're looking at the screen, without a pull-to-refresh, so a family fest dump fills in as it lands. · `public.drop_boxes`
- [ ] `ADD` `½d` **Browsing one album** — Opens an album into a scrollable grid of small photo/video previews, with a header saying how many items there are and who created it. · `public.drop_boxes`
- [ ] `ADD` `3-5d` **Dumping photos and videos into an album** — Pick a batch of photos and videos from your phone and they upload straight into the album, full quality, with progress and a retry if one fails. · `add_drop_box_media`
- [ ] `ADD` `1-2d` **Full-screen swipe through an album** — Tapping a photo opens it full screen and you swipe left/right through the whole album without closing and reopening, seeing who uploaded each one. · `public.drop_box_media`
- [ ] `ADD` `½d` **Opening a shared album link** — Tapping a link to a specific album (from Home, a call-out, or a Family Fest button) opens that album straight away instead of dumping you on the list. · `public.drop_boxes`
- [ ] `ADD` `½d` **Save one photo or video to your phone** — Saves the original, full-quality file — the one the family actually shot — to your camera roll or out through the share sheet. · `public.drop_box_media`
- [ ] `ADD` `¼d` **The Family Fest 2026 album shortcut** — Home and the Family Fest screens can drop you straight into the official fest album with one tap. · `public.drop_boxes`
- [ ] `ADD` `½d` **The list of shared albums** — Shows every shared photo/video album as a grid of cover tiles with how many items are in it and who made it, so you can tap into one. · `public.drop_boxes`
- [ ] `ADD` `¼d` **"Held for review" badge** — Marks a photo that the automatic content check flagged, so the person who uploaded it can see it's waiting on an admin instead of thinking it vanished. · `public.drop_box_media`
- [ ] `ADD` `½d` **Photos keep the date they were actually taken** — Each photo or video carries its real shot date where possible, so an album can be ordered by when things happened rather than when someone got around to uploading. · `add_drop_box_media`
- [ ] `ADD` `¼d` **Remove a photo from an album** — Lets the person who added a photo (or the album's creator, or an admin) take it back out of the album. · `remove_drop_box_media`
- [ ] `ADD` `¼d` **Sort by when taken vs when uploaded** — Lets you flip an album between newest-uploaded-first and newest-taken-first, just on your own phone. · `public.drop_box_media`
- [ ] `ADD` `½d` **Who made the album and who added each photo** — Shows the name of the person who created an album, and — in the full-screen view — who uploaded the photo you're looking at. · `profiles`
- [ ] `FINISH` `¼d` **A Home call-out that opens an album** — An admin's Home card can carry a button that drops everyone straight into a specific album. · `home_callouts`
- [ ] `ADD` `¼d` **Admin can release a held photo** — An admin looking at a held photo can approve it so everyone else can see it again. · `set_drop_box_media_status`
- [ ] `ADD` `¼d` **Archive an album** — Tucks a finished album out of the live list without deleting anything in it. · `set_drop_box_archived`
- [ ] `ADD` `½d` **Crediting a photo to the person who took it** — When an admin files someone else's old Feed post into an album, the photo is still credited to the member who posted it, not to the admin who filed it. · `add_drop_box_media`
- [ ] `ADD` `¼d` **Delete an album** — Removes an album and all the photo entries in it for good. · `delete_drop_box`
- [ ] `ADD` `1-2d` **Download a whole album (or a selection) as one zip** — Grabs every original file in an album — or just the ones you picked — as a single zip, for photo books and backups. · `public.drop_box_media`
- [ ] `ADD` `¼d` **Flagged photos are never held after the fact (backend gap)** — Today a photo the content checker flags a few seconds after upload stays visible to the whole family, because nothing goes back and holds it. · `hold_content_on_media_verdict`
- [ ] `ADD` `½d` **Remove several photos at once** — With photos selected, removes all of them from the album in one go. · `remove_drop_box_media`
- [ ] `ADD` `¼d` **Rename an album or change its emoji** — The person who made an album (or an admin) can fix its name or swap its emoji. · `update_drop_box`
- [ ] `ADD` `1-2d` **Select mode (pick several photos at once)** — A Select button turns the grid into checkboxes so you can act on a handful of photos at once instead of one at a time. · `public.drop_box_media`
- [ ] `ADD` `½d` **Start a new album** — Any member can make a new named album (with an emoji) for people to dump photos into. · `create_drop_box`

## Event sign-up slots
[`02-event-signups.md`](ios-parity-2026-08/02-event-signups.md) · 24 items · 158 warnings in the doc

- [ ] `ADD` `½d` **Slot days and times labeled correctly** — Makes sure a slot that's Friday at 9:00 AM says Friday at 9:00 AM everywhere — not the day before. · `run_signup_reminders`
- [ ] `FINISH` `3-5d` **"Anytime all week" reads the rows the family actually edits** — Moves the Anytime section (scavenger hunt, merch table) onto the same events the family edits on the web, so it stops showing stale copies. · `fest_schedule_items`
- [ ] `ADD` `½d` **Evenly spaced time slots computed from the event's window** — For an event like "12:00 to 16:00, 60 minutes each", it works out the slots (12:00, 13:00, 14:00, 15:00) instead of anyone having to list them. · `fest_schedule_slot_starts`
- [ ] `ADD` `½d` **Hand-picked slots with their own day and time** — Supports events whose slots are an arbitrary list — "Mon 10:50am, Wed 1:48pm" — each with its own day, time, label and number of spots. · `_can_manage_item_signups`
- [ ] `ADD` `½d` **Just a headcount — "who's coming", no times** — For events with no time slots at all: a running count of everyone who's coming, optionally capped. · `sign_up_for_schedule_slot`
- [ ] `ADD` `½d` **Knowing who counts as "the organizer"** — Decides who sees the organizer-only buttons — the fest committee, plus the event's own lead and crew. · `can_edit_fest`
- [ ] `ADD` `½d` **Plain-English errors shown as-is** — When a sign-up can't go through, the member reads the real reason ("Not enough spots left") instead of "Something went wrong". · `sign_up_for_schedule_slot`
- [ ] `ADD` `1-2d` **Sign someone else up (a member, or a name with no account)** — Lets any signed-in member fill a slot for someone else — picking a family member from the app, or just typing a name for a relative who isn't on it. · `sign_up_for_schedule_slot`
- [ ] `ADD` `½d` **Spot counts stay honest after every action** — Refreshes the slot list right after anyone signs up or backs out, so nobody is shown an open spot that's already gone. · `fest_schedule_signups`
- [ ] `ADD` `½d` **Take a slot for yourself** — Lets a signed-in member tap a slot and put their own name in it. · `sign_up_for_schedule_slot`
- [ ] `ADD` `½d` **Taking a name back off a slot** — Lets you remove a sign-up you made — your own, or one you entered for someone else — and lets the organizer remove any of them. · `remove_schedule_signup`
- [ ] `ADD` `¼d` **Tapping a slot reminder opens that event** — The automatic "your slot starts soon" push already reaches phones — tapping it needs to land on that event's sign-up card. · `run_signup_reminders`
- [ ] `ADD` `1-2d` **The sign-up card with its list of slots** — Shows a Family Fest event's sign-up list — the times you can take, or a single "who's coming" bucket — with how many spots are left on each. · `fest_schedule_items`
- [ ] `ADD` `1-2d` **"Notify this slot" — nudge everyone signed up, right now** — Lets the person running an event send everyone in a slot an immediate reminder, with an optional email as well. · `send_signup_slot_reminder_now`
- [ ] `ADD` `1-2d` **"View all" — the organizer's full roster table** — Gives the person running the event one scannable table of every slot, everyone in it, and their answers to the extra questions. · `fest_schedule_signups`
- [ ] `ADD` `½d` **"📝 Sign up" button on a Home call-out** — A Home call-out card can carry a Sign up button that drops you straight onto that event's sign-up card. · `home_callouts`
- [ ] `ADD` `½d` **Extra questions the organizer requires on each person** — When the organizer asked for extra info — like "Character" for a play — each person's sign-up collects and shows it. · `sign_up_for_schedule_slot`
- [ ] `ADD` `¼d` **Guests can look, but get asked to sign in to sign up** — Someone browsing without an account still sees the sign-up card, and gets a friendly sign-in prompt the moment they try to take a slot. · `sign_up_for_schedule_slot`
- [ ] `ADD` `3-5d` **Signing up as a pair or team** — For events run in fixed-size teams (baggo doubles), one sign-up collects everyone on the team at once and keeps them together. · `sign_up_for_schedule_slot`
- [ ] `ADD` `3-5d` **Surprise sign-ups: accurate count, hidden names** — For events where the lineup is a surprise (a variety show), everyone sees how many people are signed up but not who — including the organizer, until they choose to peek. · `fest_schedule_signup_counts`
- [ ] `ADD` `¼d` **The organizer's note above the slots** — Shows the free-text instructions the organizer wrote ("bring your own apron") right above the list of slots. · `fest_schedule_items`
- [ ] `ADD` `3-5d` **Adding, editing and deleting individual slots** — Lets the organizer add a slot, change how many people fit in one, or delete it. · `_can_manage_item_signups`
- [ ] `ADD` `1w+` **Setting up a sign-up (the organizer's configuration)** — Lets the person running an event turn sign-ups on and choose how they work — slots or headcount, spots per slot, times, instructions, extra questions, reminder lead times, team size, and whether names are hidden. · `can_edit_fest`
- [ ] `ADD` `1-2d` **Sign-ups on the older "activity" rows (only if you must)** — Makes sign-ups also work against the retired activities data, for any screen still backed by it. · `sign_up_for_activity_slot`

## Tournament brackets (migrations 0144–0154)
[`03-tournaments.md`](ios-parity-2026-08/03-tournaments.md) · 26 items · 151 warnings in the doc

- [ ] `ADD` `½d` **"Now" summary for spectators** — A simple screen showing which games are up right now and the last few results, for family members who will never open the bracket grid. · `public.tournament_matches`
- [ ] `ADD` `1-2d` **Bracket data loads and reads in the right order** — The players, teams, games and bracket all load for a tournament and show up in the order a person expects. · `public.tournaments`
- [ ] `ADD` `¼d` **Champion banner** — When a tournament is finished, everyone sees who won. · `public.tournaments`
- [ ] `ADD` `½d` **Honest message when you can't see the bracket yet** — A brand-new member waiting to be approved, or someone not signed in, gets told why the bracket is empty instead of seeing a blank screen. · `public.tournaments`
- [ ] `ADD` `½d` **Only the activity's organizer can run the tournament** — The person running the activity gets the buttons to seed and score; everyone else just watches. · `is_tournament_manager`
- [ ] `ADD` `1-2d` **Score a game with one tap** — The organizer taps the winner of a game and it's recorded; typing the actual scores is optional. · `record_match_result`
- [ ] `FINISH` `½d` **Tapping a tournament notification opens the bracket** — The tournament pushes people already receive on their phones actually land on the right tournament screen instead of nowhere. · `notifications`
- [ ] `ADD` `½d` **The bracket updates live while you watch** — Scores and matchups appear on your phone the moment someone else enters them, without pulling to refresh. · `public.tournaments`
- [ ] `FINISH` `½d` **Tournament section shows up on an activity** — When someone turns on tournaments for an activity, a Tournament area appears on that activity's page — and nowhere else. · `fest_schedule_items`
- [ ] `ADD` `½d` **Warning before a change wipes later games** — If the organizer changes an already-decided game, the app spells out exactly which later games will be reset before they tap. · `record_match_result`
- [ ] `ADD` `1-2d` **Watch the bracket, one round at a time** — Anyone can flip through the bracket round by round and see who plays who, who won, and the score. · `public.tournament_matches`
- [ ] `ADD` `½d` **Add or remove a person by hand** — The organizer can add someone who didn't sign up — an app member or just a typed-in name — or take someone out. · `add_participant`
- [ ] `ADD` `½d` **Pull the sign-up list into the tournament** — The organizer pulls everyone who signed up for the activity into the tournament in one tap. · `import_entrants_from_signups`
- [ ] `ADD` `1-2d` **Rename, switch format, reset, or delete a tournament** — The organizer can rename a tournament, change its format before it starts, start the bracket over, or delete it. · `update_tournament`
- [ ] `ADD` `3-5d` **Seed the players and build the bracket** — The organizer puts the players in order (or lets it be random), sees a preview of who plays who in round one, and builds the bracket. · `generate_bracket`
- [ ] `ADD` `1-2d` **Start a tournament on an activity** — The organizer creates a tournament for an activity — names it and picks the format, singles or teams. · `create_tournament`
- [ ] `ADD` `¼d` **Undo a game's result** — The organizer can wipe a game's result so it can be replayed. · `clear_match_result`
- [ ] `ADD` `½d` **Allow a game to end in a tie** — For a round-robin, let a game be recorded as a draw instead of forcing a winner. · `update_tournament`
- [ ] `ADD` `1-2d` **Give a game a time (with reminders)** — The organizer can set when a game happens and have the players reminded beforehand. · `schedule_match`
- [ ] `ADD` `1-2d` **Move a player to a different spot in the bracket** — The organizer can drag a player or team into a different slot, or swap two of them. · `set_match_entrant`
- [ ] `ADD` `3-5d` **Pools then a knockout bracket** — Players are split into pools that each play a mini round-robin, then the top finishers move into a knockout bracket. · `generate_pools`
- [ ] `ADD` `½d` **Re-sync players from a private activity's roster** — For a private get-together, the organizer can re-pull the invited people into the tournament. · `import_entrants_from_activity_members`
- [ ] `ADD` `3-5d` **Round-robin: everyone plays everyone, with a standings table** — A format where every player or team plays each other once, with a W-L table that ranks everyone. · `generate_round_robin`
- [ ] `ADD` `1-2d` **Teams — make them, group them, ungroup them** — For a doubles tournament, the organizer can enter an existing team, randomly pair everyone into teams, or dump everyone back into one pile. · `add_entrant`
- [ ] `ADD` `½d` **Tell both sides their game is up** — The organizer taps a button and both sides of a game get a push telling them who they're playing. · `notify_match`
- [ ] `ADD` `1-2d` **Tournaments on a private get-together** — A member-created private activity can run its own tournament, visible only to the people invited. · `create_activity_tournament`

## Private activities
[`04-private-activities.md`](ios-parity-2026-08/04-private-activities.md) · 22 items · 136 warnings in the doc

- [ ] `ADD` `¼d` **"This one has a tournament" (v1 placeholder)** — Shows that an activity is set up as a tournament and points people to the web app to run the bracket, until the native bracket ships. · `private_activities`
- [ ] `ADD` `½d` **Add people to an activity** — An organizer can invite more family later — either an app member or just a typed-in name. · `add_private_activity_member`
- [ ] `ADD` `1-2d` **Create an activity** — Any signed-in member can start a private get-together — a name, an emoji, where, an optional time (or "no set time") — and pick the handful of people it's shared with. · `create_private_activity`
- [ ] `ADD` `1-2d` **Open an activity** — Tapping an activity shows the whole plan — what, when, where, the note, and everyone who's in with their yes/maybe/no — plus the organizer's controls. · `private_activities`
- [ ] `ADD` `½d` **Organizer powers (who can change things)** — The creator, anyone made an organizer, and app admins see the edit / add-people / archive / delete controls; everyone else just sees the plan. · `public.is_private_activity_member`
- [ ] `ADD` `½d` **Say if you're coming** — Anyone on the list taps Going / Maybe / Can't — and tapping their current answer again clears it. · `set_private_activity_rsvp`
- [ ] `ADD` `½d` **Tapping an invite opens the activity** — Tapping the invite notification (or a shared link) lands you straight on that activity's page. · `_notify_private_activity_invite`
- [ ] `ADD` `¼d` **Unverified members see the activity but not its bracket** — A brand-new member who hasn't been verified yet can open an activity they were added to, but its tournament comes back empty — so the screen has to say so instead of looking broken. · `is_approved_member`
- [ ] `ADD` `1-2d` **Your activities list on the Events screen** — Shows the invite-only get-togethers you've been included in, right on the Events screen, each with a one-line summary of who's in and whether it has a tournament. · `private_activities`
- [ ] `ADD` `½d` **"Let them know" invite notification** — An optional ping to just the people who were added — off by default, so nobody gets bothered unless the organizer asks for it. · `create_private_activity`
- [ ] `ADD` `½d` **Archive a finished game** — An organizer tucks a finished get-together away under a "Finished & archived" section instead of deleting it. · `set_private_activity_archived`
- [ ] `ADD` `½d` **Changes show up without a refresh** — When someone RSVPs, is added, or edits the plan, everyone's screen updates on its own — including the moment you're added to a brand-new activity. · `private_activities`
- [ ] `ADD` `¼d` **Delete an activity** — An organizer can remove the whole get-together for everyone, permanently. · `delete_private_activity`
- [ ] `ADD` `½d` **Edit the plan** — An organizer can change the name, place, note, emoji, or time of an activity — or switch it back to "no set time". · `update_private_activity`
- [ ] `ADD` `¼d` **Make someone an organizer** — An organizer can hand co-organizer powers to another app member on the list (or take them back). · `set_private_activity_member_role`
- [ ] `ADD` `½d` **People who aren't on the app** — Lets an organizer include family who don't have accounts by just typing their name — they show on the roster and can play, they just can't be pinged or answer. · `add_private_activity_member`
- [ ] `ADD` `½d` **Remove someone / leave an activity** — An organizer can take someone off the list, and anyone on the list can bow out themselves. · `remove_private_activity_member`
- [ ] `ADD` `1-2d` **Set up the tournament** — An organizer turns the activity into a real tournament, and everyone on the list is entered automatically. · `create_activity_tournament`
- [ ] `ADD` `3-5d` **Watch and score the bracket** — Everyone on the list can follow the bracket, and the organizer taps the winner of each game to move it along. · `generate_bracket`
- [ ] `ADD` `½d` **Change the tournament format** — Before any games are played, the organizer can switch between a knockout bracket, everyone-plays-everyone, or pools. · `set_tournament_format`
- [ ] `ADD` `½d` **Re-sync players from the activity** — If people were added or dropped after the tournament was set up, the organizer can rebuild the player list from the current roster. · `import_entrants_from_activity_members`
- [ ] `ADD` `1w+` **Round-robin and pools tournaments** — Runs the other two tournament styles — everyone plays everyone with a standings table, or pool play that feeds into a knockout. · `set_tournament_format`

## Meetings (when2meet) and quick polls in chat
[`05-meetings-and-chat-polls.md`](ios-parity-2026-08/05-meetings-and-chat-polls.md) · 31 items · 201 warnings in the doc

- [ ] `ADD` `¼d` **Fixing the three duplicated database functions (hand the SQL to Brian)** — A one-time database cleanup, without which family-wide date polls, whole-date-range options, and "yes I'm still coming" confirmations cannot work at all. · `create_meeting`
- [ ] `ADD` `½d` **Loading a room's quick polls and your own answers** — Fetches every poll in a committee or house chat with its vote counts and which options you personally picked. · `fetch_chat_polls_for_room`
- [ ] `ADD` `1-2d` **Seeing a room's meetings and their proposed times** — Loads the meetings for the committee channel, house, or the whole family, together with the time options that were proposed, so anything about a meeting can appear in the app. · `can_access_committee_area`
- [ ] `FINISH` `1-2d` **Attaching a photo, video, or file in a room chat** — Lets someone add a photo, take one, or pick a file while chatting in a committee or house room.
- [ ] `ADD` `1-2d` **Getting told about a meeting (in-app and on your phone)** — Sends everyone in the room a notification when a meeting is proposed and again when it's set, and taps land on the right meeting. · `_notify_meeting_room`
- [ ] `ADD` `1-2d` **Locking in a time with a Google Meet link** — The organizer picks the winning time, optionally pastes a Google Meet link, and the whole room gets told in the chat plus an email with a Join button. · `finalize_meeting`
- [ ] `ADD` `1-2d` **Marking when you're free (Yes / If-need-be / No)** — Lets every member of the room say, for each proposed time, whether they can make it, might be able to, or can't. · `set_my_availability`
- [ ] `ADD` `½d` **Meeting answers and tallies updating live** — Keeps a meeting's vote counts and time options current on screen while other people are answering, without pulling to refresh. · `meetings`
- [ ] `ADD` `¼d` **Only the right people see "Schedule a meeting"** — Hides the option to start a meeting from anyone who isn't allowed to run one in that room. · `can_organize_meeting`
- [ ] `ADD` `½d` **Poll counts moving live** — Vote counts on a poll card update as other people vote, without a refresh. · `chat_polls`
- [ ] `ADD` `½d` **Polls appearing in the conversation where they happened** — Mixes polls into the chat's message list in time order, so a poll shows up right where it was asked instead of in a bar you scroll past. · `chat_polls`
- [ ] `ADD` `3-5d` **Proposing times and opening a meeting for votes** — Lets an organizer suggest up to ten possible times for a get-together and ask everyone in the room to mark when they're free. · `create_meeting`
- [ ] `ADD` `1-2d` **Starting a poll in a chat** — Any member of a committee or house chat can ask the room a question with 2–10 answers, choosing single- or multi-select and whether results are anonymous. · `create_chat_poll`
- [ ] `ADD` `1-2d` **The meeting bar at the top of a chat** — When a meeting is live in a room, a strip at the top of that chat invites everyone to mark when they're free — and shows nothing at all the rest of the time. · `meetings`
- [ ] `ADD` `3-5d` **The meeting scheduler screen** — One screen where you mark your availability, see how everyone answered, see which time is winning, and (if you're the organizer) lock the meeting in. · `set_my_availability`
- [ ] `ADD` `1-2d` **The poll card itself** — Shows the question, each option with a filled bar and its share of the vote, a check on your own picks, and who voted for what when the poll isn't anonymous. · `chat_poll_voters`
- [ ] `ADD` `½d` **Vote counts and the "best time so far"** — Works out, for each proposed time, who said yes, who said if-need-be and who said no, and which option is winning. · `meeting_availability`
- [ ] `ADD` `½d` **Voting in a chat poll** — Tapping an option records your answer right away, and you can change it while the poll is open. · `set_chat_poll_votes`
- [ ] `ADD` `¼d` **A poll that closes on its own date** — A poll can be set to stop taking votes after a given day, and the card should show it as closed once that day has passed. · `set_chat_poll_votes`
- [ ] `ADD` `½d` **Cancelling or deleting a meeting** — Lets the person who created a meeting (or an admin) call it off, keeping a cancelled record, or remove it entirely. · `cancel_meeting`
- [ ] `ADD` `¼d` **Closing or deleting a poll** — The person who started a poll (or an admin) can stop it taking votes, or remove it from the chat entirely. · `close_chat_poll`
- [ ] `ADD` `½d` **Getting told a poll was started** — Everyone in the room gets a notification when someone starts a poll, and tapping it opens that room. · `notifications`
- [ ] `ADD` `1-2d` **Setting one known time with no voting** — Lets an organizer just announce a meeting at a time they already know, skipping the whole voting step. · `create_scheduled_meeting`
- [ ] `ADD` `1-2d` **Turning the winning date into a real calendar event** — Instead of a video call, the organizer can turn the winning date into an actual event on the resort calendar, with everyone who voted yes already pencilled in as coming. · `finalize_meeting_as_event`
- [ ] `ADD` `¼d` **"Also email everyone a link to vote"** — An optional tick when proposing times that emails the room a heads-up with a button that opens the voting screen. · `create_meeting`
- [ ] `ADD` `1-2d` **"Hasn't confirmed yet" on a meeting-created event** — For an event made from a meeting vote, shows which people were pencilled in from their vote but haven't actually confirmed they're coming — and lets tapping your Going/Maybe/Can't control count as that confirmation. · `set_event_attendance`
- [ ] `ADD` `½d` **Family-wide date polls ("which weekend works?")** — An admin can ask the whole family — not just one committee or house — which dates work, with the poll living on the Events screen. · `create_meeting`
- [ ] `ADD` `1-2d` **Proposing whole date ranges instead of times** — Lets an organizer offer spans of days ("Fri Jul 25 – Sun Jul 27") as the options people vote on, instead of an hour-long call. · `create_meeting`
- [ ] `ADD` `½d` **Seeing who voted for what** — On a poll that isn't anonymous, shows little avatars of the people behind each option (and their write-in text). · `chat_poll_voters`
- [ ] `ADD` `½d` **The "Other" write-in answer** — Lets a poll accept a typed-in answer of your own instead of only the listed options. · `create_chat_poll`
- [ ] `ADD` `½d` **The meeting bar on Events and on a committee page** — Shows the same meeting response strip as a rounded card on the Events screen and on a committee's page, so people find it outside the chat too.

## House lists, Leads chat, and lead-run rosters
[`06-house-lists-and-leads.md`](ios-parity-2026-08/06-house-lists-and-leads.md) · 21 items · 132 warnings in the doc

- [ ] `FINISH` `½d` **Tapping a Leads notification opens the Leads room** — When a lead gets a phone notification about a Leads-room message, tapping it lands on that message instead of nowhere. · `committee_roster`
- [ ] `ADD` `¼d` **"We're home from the store" — clear the checked items** — One tap deletes everything already checked off, so a shopping list doesn't have to be rebuilt by hand next time. · `clear_checked_house_list_items`
- [ ] `ADD` `1-2d` **A private Leads room appears for people who lead a committee** — If you lead a committee (or one of its subcommittees), a private room for just the leads shows up in your chat list — and nobody else, not even an admin, sees it. · `is_committee_lead`
- [ ] `ADD` `½d` **Add something to a list** — Type a line — milk, close the shutters, bug spray — and it lands at the bottom of the list for everyone in the house. · `add_house_list_item`
- [ ] `ADD` `½d` **Check something off (and un-check it)** — Tap the box next to an item to mark it done, or tap again to put it back on the list. · `set_house_list_item_checked`
- [ ] `ADD` `½d` **Lists update live while you're looking at them** — When someone else in the house adds or checks something, it appears on your screen without a refresh. · `house_lists`
- [ ] `FINISH` `½d` **Read and post in the Leads room** — The leads of a committee get a normal chat room of their own — messages, photos, reactions, replies — that only they can see. · `can_access_committee_area`
- [ ] `ADD` `¼d` **Reuse a checklist next trip** — One tap un-checks every item so the cabin close-up checklist is ready to run again. · `uncheck_house_list_items`
- [ ] `ADD` `1-2d` **See the house's shared lists** — Open a screen showing every list your house has going — the grocery run, the cabin close-up checklist, what to pack — with each list's items and how many are done. · `house_lists`
- [ ] `ADD` `½d` **Start a new list** — Anyone in the house can start a list with a name, an emoji handle, and an optional note. · `create_house_list`
- [ ] `ADD` `¼d` **"Got by {name}" under a checked item** — A checked-off item shows who got the milk or closed the windows, and when. · `house_list_items`
- [ ] `FINISH` `½d` **@mention the right people in a committee room** — Typing @ in a committee or Leads room offers everyone who can actually see that room — including people added the modern way. · `committee_roster`
- [ ] `ADD` `¼d` **Delete a list** — Any member of the house can throw away a whole list once it's done with. · `delete_house_list`
- [ ] `ADD` `½d` **Lead chats grouped at the top of the chat list** — Your chat list separates the private lead rooms from the whole-committee room and your subcommittee rooms, so they're easy to tell apart. · `committee_messages`
- [ ] `ADD` `¼d` **Lists row on the House Hub** — The house's home screen shows the top list and how far along it is, and taps through to all the lists. · `house_lists`
- [ ] `FINISH` `¼d` **Mute the Leads room** — Turn off notifications for the Leads room, permanently or until a date. · `set_area_mute`
- [ ] `ADD` `¼d` **Remove an item from a list** — Delete a line off the list outright, instead of checking it off. · `delete_house_list_item`
- [ ] `ADD` `½d` **Rename a list, change its emoji, or edit its note** — Any member of the house can retitle a list, swap its emoji, or change the note under it. · `update_house_list`
- [ ] `FINISH` `¼d` **Unread badge for the Leads room** — The Leads room shows an unread dot like any other chat, and clears when you open it. · `mark_area_read`
- [ ] `ADD` `½d` **Who's in this room (Leads)** — Open the room's member list and see every lead of that committee, including people who don't have an app account yet. · `committee_roster`
- [ ] `ADD` `¼d` **Fix the wording of an item** — Edit an item's text — "milk" becomes "2% milk, 2 gallons". · `update_house_list_item`

## Posts feed and comments — depth audit
[`07-posts-feed-depth-audit.md`](ios-parity-2026-08/07-posts-feed-depth-audit.md) · 20 items · 93 warnings in the doc

- [ ] `ADD` `½d` **"Pending review" and "Removed" states on posts and comments** — A post held for review shows its author an amber "only you and admins can see this" note instead of vanishing without explanation; an admin-removed one is clearly marked. · `set_content_status`
- [ ] `AUDIT` `1-2d` **Comments on a post** — Anyone can comment under a post; the author or an admin can delete a comment. · `post_comments`
- [ ] 🚨 `ADD` `½d` **Photos actually loading (signed media reads)** — Every photo and video URL needs a short-lived signed token, or the media server refuses to serve it.
- [ ] `AUDIT` `3-5d` **Sharing a post (photos, video, caption, date)** — Lets a member write something, attach any number of photos and videos, tag people, optionally set the date it actually happened, and post it. · `create_post`
- [ ] `AUDIT` `1-2d` **The Family Feed itself** — Shows every post the family has shared, newest first, grouped under day headings like Today / Yesterday / Saturday, July 27, 2026. · `posts`
- [ ] `FINISH` `1-2d` **@mentioning someone in a comment** — Type @ and a name to tag a family member in a comment; their name renders highlighted and they get a notification that lands on that exact comment. · `post_comment_mentions`
- [ ] `ADD` `1-2d` **Editing a post** — The author (or an admin) can change the caption, add or remove photos and videos, add or remove tagged people, move the date, or delete it — all from one sheet. · `posts`
- [ ] `AUDIT` `1-2d` **Emoji reactions, including who reacted** — Tap to react with one of six emoji; tap the count chip to see exactly which family members reacted with it. · `post_reactions`
- [ ] `ADD` `½d` **Flagging a post or comment as inappropriate** — Any member can flag something with a reason; two independent flags hide it for everyone until an admin reviews it, and it disappears for the flagger immediately. · `report_content`
- [ ] `FINISH` `½d` **Full-screen photo viewer that swipes across the post** — Tapping any photo opens it full-screen and you can swipe straight through the rest of that post's photos without closing and reopening.
- [ ] `ADD` `½d` **Notifications that land on the exact comment** — Tapping "Alice commented on your post" scrolls straight to Alice's comment and flashes it, instead of dumping you at the top of a long thread. · `notifications`
- [ ] `AUDIT` `1-2d` **Photo/video carousel on a post** — A post with several photos becomes a swipeable set of pages with dots and an "3/7" counter; videos play right in place. · `post_media`
- [ ] `ADD` `1-2d` **Photos and videos on a comment** — Answering "which cabin?" with a picture, instead of having to start a whole new post. · `post_comment_media`
- [ ] `ADD` `½d` **"Also add these photos to an album"** — One checkbox saves a post's photos into a shared downloadable album too, so nobody has to add them twice — and it works retroactively on an old post. · `add_drop_box_media`
- [ ] `FINISH` `¼d` **Deleting a post** — The author or an admin removes a post entirely, along with its photos, comments and reactions. · `posts`
- [ ] `FINISH` `½d` **Posting something back to when it happened** — "Posting late? Place it back to when it happened so it flows in with the rest" — a photo from Tuesday's lake day lands on Tuesday, not today. · `create_post`
- [ ] `FINISH` `½d` **Tagging people in a post (and the "Tagged me" filter")** — Pick family members to tag on a post; their names show under the caption and they get notified, and anyone can filter the feed to just posts they're tagged in. · `post_tags`
- [ ] `AUDIT` `1-2d` **The feed staying live, and painting instantly on launch** — New posts, comments and reactions appear without pulling to refresh, and reopening the app shows the top of the feed immediately instead of a spinner. · `posts`
- [ ] `ADD` `½d` **Jumping to a month or a day in the feed** — A Filter button reveals month chips built from the posts that exist, plus a "jump to a day" date picker. · `posts`
- [ ] `FINISH` `¼d` **Sharing a post outward** — Sends a post's caption (and on iOS, the photo itself) out to Messages, Mail, or the family Facebook group.

## Committee & house chat — depth audit
[`08-chat-depth-audit.md`](ios-parity-2026-08/08-chat-depth-audit.md) · 21 items · 122 warnings in the doc

- [ ] 🚨 `ADD` `½d` **Chat photos and videos actually load** — Signs every photo, video and file URL in a chat bubble so the media server serves it instead of refusing it.
- [ ] `FINISH` `1-2d` **Per-subcommittee channels inside a committee** — A committee has one room for everybody plus a separate room for each subcommittee you're on, so the Meals crew can talk without the whole committee reading it. · `can_access_committee_area`
- [ ] `AUDIT` `½d` **@mention people in the room** — Type @ to tag someone who can actually see this room; they get a notification and their name is highlighted in the message. · `committee_message_mentions`
- [ ] `ADD` `1-2d` **Chat opens instantly and works on bad wifi** — The room paints the last conversation immediately from the device and only fetches what's new, so it works on lake wifi and doesn't burn data. · `committee_messages`
- [ ] `ADD` `1-2d` **Held messages disappear (and their author is told why)** — A message the safety filters flag drops out of the room for everyone else until an admin approves it — and the person who sent it can see that it's on hold instead of wondering why nobody replied. · `set_content_status`
- [ ] `FINISH` `1-2d` **Messages appear the instant you hit send** — Your message and its photos show up immediately, upload in the background, and come back into the composer with a clear reason if something fails. · `committee_messages`
- [ ] `ADD` `½d` **Mute a chat for a day, three days, a week, or indefinitely** — Silence a busy room's notifications for a chosen stretch of time, after which it un-mutes itself. · `set_area_mute`
- [ ] `AUDIT` `1-2d` **Photos, videos and files in chat bubbles load fast** — Attachments show as small previews that open full-screen when tapped, instead of downloading the full-size original into every bubble. · `committee_message_media`
- [ ] `ADD` `1-2d` **Private Leads chat per committee** — A room only the committee's leads can see, for the conversations leads need to have among themselves. · `can_access_committee_area`
- [ ] `AUDIT` `1-2d` **Tapping a chat notification lands on the right message** — A mention or new-message notification opens the exact room and scrolls to the exact message being talked about. · `notif_on_chat_mention`
- [ ] `AUDIT` `1-2d` **The conversation list** — One Messages-style screen listing the family feed, your house, your lead chats, each committee's full-crew room, and each of your subcommittee rooms — with last message, time, unread count and a mute bell on every row. · `committee_roster`
- [ ] `FINISH` `1-2d` **Unread badges and marking a room read** — Each room shows how many messages you haven't seen and the last thing anyone said; opening the room clears it. · `mark_area_read`
- [ ] `ADD` `3-5d` **Answer a meeting proposal from inside the room** — When someone proposes meeting times for this committee or house, a bar at the top of the chat lets everyone mark when they're free and shows the organizer the winning slot. · `can_organize_meeting`
- [ ] `ADD` `½d` **Archived chats stay readable** — When a committee or subcommittee is 'deleted', its chat history stays browsable but closed to new messages. · `is_committee_area_archived`
- [ ] `AUDIT` `½d` **Edit or delete your own message for 24 hours** — Fix a typo or take back a message within a day of sending it; admins can remove anything at any time, and the bubble becomes 'message deleted' for everyone. · `committee_messages`
- [ ] `ADD` `3-5d` **Quick polls right in the conversation** — Drop a question with a few options into the chat; people tap to vote and see the results fill in live, with an option to keep it anonymous. · `fetch_chat_polls_for_room`
- [ ] `AUDIT` `½d` **Replies that quote the original** — Reply to a specific message; the reply shows a tappable snippet of what it answers, and jumps to it when tapped. · `committee_messages`
- [ ] `ADD` `½d` **See when someone is typing** — A small 'X is typing…' line above the keyboard while someone else is composing.
- [ ] `AUDIT` `½d` **Tapback reactions that show who reacted** — Long-press a message to react, and tap a reaction pill to see the names of everyone who picked that emoji. · `committee_message_reactions`
- [ ] `FINISH` `½d` **The room reads like a real messages app** — Day separators, messages from the same person grouped together, a jump-to-latest pill when you've scrolled up, and no yanking you away from history when a new message arrives.
- [ ] `ADD` `½d` **Report a message** — Lets a member flag an inappropriate chat message for admin review. · `report_content`

## Events + RSVP, and cabin stays
[`09-events-and-cabins.md`](ios-parity-2026-08/09-events-and-cabins.md) · 24 items · 133 warnings in the doc

- [ ] `AUDIT` `1-2d` **Approve / deny a stay request** — Whoever reviews a place sees waiting requests and approves or denies them, optionally with a note that rides along in the email. · `review_cabin_stay`
- [ ] `AUDIT` `1-2d` **Going / Maybe / Can't make RSVP** — Lets you tell everyone whether you're coming to an event, and shows the running tally of who is. · `set_event_attendance`
- [ ] `AUDIT` `1-2d` **Request a cabin stay** — Lets a member ask for a room in one of the resort's cabins or houses for any dates, defaulting to Family Fest week. · `request_cabin_stay`
- [ ] `AUDIT` `1-2d` **The resort calendar (Events list)** — Shows every upcoming resort gathering — Family Fest, the 4th of July, work weekends and one-off events — newest-first with past ones tucked away. · `events`
- [ ] `AUDIT` `½d` **"Not sure yet" + choose your room later** — Lets someone book without picking a room yet, then come back and choose it themselves once they know. · `set_booking_rooms`
- [ ] `FINISH` `½d` **"X of Y rooms / beds left"** — Shows at a glance how much room is left in each place for the dates you're looking at, without exposing anyone else's booking. · `cabin_availability`
- [ ] `ADD` `1-2d` **A per-place approver who isn't an app admin** — Lets the owner of a private house review requests for their own place without giving them any other admin powers, and shows them their queue on the normal member-facing stay screen. · `is_cabin_approver`
- [ ] `AUDIT` `1-2d` **Create / edit / delete an event (admin)** — Lets an admin add a resort event with a title, emoji, dates, optional start time, location, description and the per-day RSVP option. · `create_event`
- [ ] `FINISH` `1-2d` **Per-day RSVP for a multi-day event** — For a week-long event like Family Fest, lets you tap just the days you'll actually be there and shows how many people are around each day. · `set_event_attendance`
- [ ] `ADD` `½d` **Phone alert for a new cabin request** — Buzzes whoever reviews a place when a new stay request comes in, instead of them having to open the app to find out. · `notif_on_cabin_request`
- [ ] `AUDIT` `1-2d` **Picking a specific room** — For a place broken into named rooms ("Upstairs South Room"), lets you pick exactly which spot you want instead of just a room count — so two people can tell whether they'd be sharing. · `cabin_room_availability`
- [ ] `FINISH` `½d` **Who's coming (event roster)** — Shows the names and faces of everyone going, maybe, or not coming — and for a week-long event, who's here on each specific day. · `event_attendance`
- [ ] `FINISH` `½d` **"Upcoming Up North" on Home** — Puts the nearest event on the home screen with a one-tap RSVP, plus the next couple as quiet rows. · `events`
- [ ] `ADD` `½d` **Add a new place to stay (admin)** — Lets an admin add another bookable place — a shared cabin or a family member's private house with spare bedrooms — and name who reviews it. · `create_cabin`
- [ ] `AUDIT` `½d` **Book a stay for someone else (admin)** — Lets an admin book a room for a family member who doesn't use the app, and approve it in the same step. · `request_cabin_stay`
- [ ] `AUDIT` `¼d` **Cancel a stay** — Lets a member cancel their own request, or whoever reviews the place cancel someone's stay. · `cancel_cabin_stay`
- [ ] `AUDIT` `½d` **Edit an existing request (dates, guests, notes, rooms)** — Lets whoever reviews a place fix a request after the fact — move the dates, trim '2 beds' to 1, swap which room it uses — all in one sheet. · `admin_update_cabin_booking`
- [ ] `FINISH` `½d` **Hiding alerts from people who can't make an event** — An admin can tie an alert or Home card to an event so anyone who already said 'can't make it' doesn't get bothered by it. · `send_broadcast_notification`
- [ ] `ADD` `½d` **Message the guests staying at a place** — Lets whoever runs a place send one note to everyone currently or soon staying there — "water's off this weekend", "gate code changed". · `send_cabin_message`
- [ ] `ADD` `½d` **Unconfirmed RSVPs from a date poll** — When a family date poll turns into a real event, everyone who said they were available starts out marked as coming but flagged 'hasn't confirmed' until they tap their own RSVP again. · `finalize_meeting_as_event`
- [ ] `FINISH` `¼d` **"X is going to …" notification** — Optionally tells the family when someone marks themselves as going to an event. · `set_event_attendance`
- [ ] `AUDIT` `1-2d` **Edit a place and its rooms (admin)** — Lets an admin rename a place, set its room and bed counts, add a note members see, open or close it, and add / rename / open / close / delete its named rooms. · `cabins`
- [ ] `FINISH` `½d` **Scheduled reminders for an event** — An admin can queue 'remind everyone 2 hours before' or 'a day before' notifications for a specific event. · `update_scheduled_broadcast`
- [ ] `FINISH` `½d` **Work items planned for an event** — Shows the resort to-do items planned for a given event, so people know what work is happening that weekend. · `sync_event_work_items`

## Ask for Help, presence, and the Home cards
[`10-ask-for-help-and-home.md`](ios-parity-2026-08/10-ask-for-help-and-home.md) · 15 items · 99 warnings in the doc

- [ ] `ADD` `1-2d` **"Am I at the resort?" presence gate (no geolocation)** — Decides whether you count as being up north today — from your RSVPs and cabin stays, not from your phone's location — which is what unlocks asking for help and what decides who gets asked. · `_help_recipients`
- [ ] `FINISH` `¼d` **"Willing to help" opt-in** — A switch in your settings saying you're happy to be asked for a hand while you're up north. · `profiles.willing_to_help`
- [ ] `ADD` `½d` **"I did this — don't show again" (permanent callout completion)** — Once you've actually ordered the t-shirts, one tap stops that card nagging you forever, on every device — unlike swiping it away, which only lasts until the next time you open the app. · `home_callout_completions`
- [ ] `FINISH` `3-5d` **Ask for Help (post a request + the shared log + "On my way")** — Someone at the resort posts a quick request for a hand, everyone willing and also up there gets pinged, and helpers tap "On my way" — with the open requests visible to everyone in one list. · `request_help`
- [ ] `ADD` `3-5d` **Home swipe-away call-out stack** — Temporary notices (a t-shirt order flyer, a work-weekend poster) stack as cards at the top of Home that you can swipe away, with the Family Fest card permanently underneath so the slot never grows or empties. · `home_callouts`
- [ ] `ADD` `½d` **Urgent help — alerts everyone, can't be muted** — Marking a request Urgent makes it an emergency: it goes to every member in the family app-wide, regardless of who's up north or who opted in. · `_notify `
- [ ] `FINISH` `½d` **"Did it get done?" follow-up (iOS-only today)** — If a help request was linked to a resort to-do task, later that evening the app asks the person who requested it whether the job actually got finished. · `request_help`
- [ ] `ADD` `1-2d` **"Up North today" card** — A strip on Home showing who's at the resort today, with a tap-through to the full list and each person's profile. · `events`
- [ ] `ADD` `½d` **"What to bring" checklist with race-safe claiming** — The person asking lists what's needed (2 long tables, 6 chairs, 3 coolers) and helpers tick off the ones they're bringing — one bringer per item. · `claim_help_item`
- [ ] `ADD` `½d` **Schedule a help request for a future event you're going to** — Ask now for help at an upcoming weekend you're RSVP'd to, so everyone attending hears about it today and can plan. · `request_help — p_eligible=[event.id], p_strict=[] `
- [ ] `ADD` `1-2d` **"On this day" photo memory** — A photo from the family feed taken around this date in a previous year. · `posts`
- [ ] `ADD` `¼d` **Active poll card on Home** — Spotlights the newest open family poll with its running vote count, linking straight to voting. · `polls`
- [ ] `ADD` `1-2d` **Create and edit Home call-outs (admin / fest committee)** — An admin or Family Fest committee member writes the notice card everyone sees on Home — image, text, action buttons, a show window, and optionally a notification or email at the same time. · `send_broadcast_notification`
- [ ] `ADD` `½d` **Lake weather card** — Current temperature and today's high/low for the lake, tapping to reveal a five-day forecast.
- [ ] `ADD` `½d` **Upcoming birthdays card** — Names of family members with a birthday in the next two weeks, tapping through to their contact card. · `profiles.birthday`

## Activity feed, notification preferences, and push
[`11-notifications-and-push.md`](ios-parity-2026-08/11-notifications-and-push.md) · 20 items · 98 warnings in the doc

- [ ] 🚨 `AUDIT` `½d` **APNs device token registration** — Registers this iPhone so the resort's Mac mini can reach it, and cleans up when you sign out. · `apns_subscriptions`
- [ ] `AUDIT` `1-2d` **Handling a tapped push and landing on the right screen** — Tapping a notification opens the exact post, comment, chat message, request or slot it was about — never just the app's home screen. · `mark_notification_read`
- [ ] `FINISH` `1-2d` **Activity tab (the notifications feed)** — A personal list of everything that happened involving you — comments and reactions on your posts, mentions, new posts, committee decisions, cabin news, reminders and announcements — that keeps working even when the phone got no push. · `mark_notifications_seen`
- [ ] `ADD` `½d` **An app icon badge that is actually correct** — The number on the home-screen icon matches how many new things are really waiting, without opening the app. · `notifications`
- [ ] `ADD` `¼d` **Cabin stay request push for iPhone admins and approvers** — Whoever approves stays at a place gets buzzed when someone requests one — which currently only happens in a browser, not on an iPhone. · `cabin_bookings`
- [ ] `ADD` `¼d` **Don't break when the server invents a new notification kind** — Nothing visible — it stops one unrecognised item from blanking the whole Activity tab. · `notifications`
- [ ] `ADD` `¼d` **Guard against a notification kind that silently never pushes** — Nothing a member sees — it stops a whole category of notification from being invisible to everyone forever. · `profiles`
- [ ] `FINISH` `1-2d` **Notification preferences (which activities show in Activity)** — Per-kind on/off switches controlling what lands in your Activity tab, grouped into labelled sections. · `profiles`
- [ ] `FINISH` `1-2d` **Push notification preferences (what buzzes the phone)** — A master push switch plus per-category picks for what actually buzzes the phone, separate from the in-app Activity list. · `profiles`
- [ ] `FINISH` `½d` **Unread badge and the seen/read/expired model** — The red count on the Activity tab, and the bold-versus-read look of each row. · `mark_notifications_seen`
- [ ] `FINISH` `1-2d` **Act on a notification without opening the app** — "On my way" on a help request, Going / Can't-make-it on an event, Approve / Decline on a committee join request, Done / Still-open on a work follow-up — straight from the notification. · `respond_to_help`
- [ ] `ADD` `1-2d` **Admin: send an announcement to everyone's Activity tab** — An admin sends a one-off notice that lands in every member's Activity list and buzzes anyone with broadcast alerts on. · `send_broadcast_notification`
- [ ] `ADD` `½d` **Admin: test one member's notifications and record who's confirmed** — An admin pings one specific member to check their notifications actually work, and ticks them off a list once they've watched it land. · `send_test_notification`
- [ ] `FINISH` `½d` **First-run "turn on notifications?" step** — A new member is asked once, during sign-up, whether to turn on phone notifications — with everything sensible pre-ticked. · `profiles`
- [ ] `ADD` `½d` **Group a burst of notifications into one stack** — Ten comments on one post collapse into a single "9 more comments on your post" stack instead of ten separate banners.
- [ ] `ADD` `½d` **On-device reminders that work even if the resort's server is down** — Your own sign-up slot still reminds you on time even if the Mac mini at the resort is off, the router is down, or the internet isn't there. · `fest_schedule_slots`
- [ ] `ADD` `¼d` **Push when you're @mentioned in a chat** — Being tagged by name in a committee or house chat buzzes your phone, even if you've turned off the every-message firehose. · `committee_message_mentions`
- [ ] `ADD` `1-2d` **A photo preview inside the notification** — A comment or new post about a photo shows that photo right on the lock screen. · `post_media`
- [ ] `ADD` `3-5d` **Live Activity during Family Fest week** — During the fest, the Lock Screen and Dynamic Island show what's next today and when your own sign-up slot starts, without unlocking the phone. · `run_signup_reminders`
- [ ] `ADD` `¼d` **Swipe a notification away** — Clear an item out of your Activity list for good. · `notifications`

## Committees, roles, roster & the family roster
[`12-committees-and-roster.md`](ios-parity-2026-08/12-committees-and-roster.md) · 14 items · 93 warnings in the doc

- [ ] `AUDIT` `½d` **A placeholder upgrades to a real account by email** — Someone can be listed on a committee before they have an account; the moment they sign up with that email their spot becomes their spot — real name, photo, contact and chat access — with no duplicate entry. · `link_committee_roster`
- [ ] `FINISH` `3-5d` **Add, edit and remove people on a committee; assign subcommittees; make leads** — An admin or a committee's lead adds someone (with or without an app account), edits their name/email/phone, ticks which subcommittees they're on, marks leads, and removes people. · `is_committee_lead_slug`
- [ ] `FINISH` `1-2d` **Approve or reject join requests** — Whoever runs a committee sees who has asked to join, with the areas they picked, and approves or rejects them. · `review_join_request`
- [ ] `ADD` `½d` **Committee-level leads (a lead with no subcommittee)** — A committee can name as many overall leads as it likes without needing any subcommittees at all — they get the private Leads chat and can run the roster. · `is_committee_lead`
- [ ] `AUDIT` `1-2d` **Committees list & a committee's page** — Browse every committee, see how many people are on it and what subcommittees it has, then open one to read its description, roles and roster. · `committees`
- [ ] `FINISH` `1-2d` **Request to join a committee** — A member asks to be added to a committee, picking at least one thing they'd like to help with, and a lead approves. · `request_to_join`
- [ ] `AUDIT` `3-5d` **The committee roster (who's on it, grouped by subcommittee)** — Shows everyone on a committee grouped by the subcommittee they help with, marks the leads, marks people who haven't joined the app yet, and gives each person a Text/Call/Email row. · `committee_roster`
- [ ] `ADD` `½d` **The private "Leads" chat entry point** — Every committee has a side room only its leads can see, for discussing and deciding without the whole committee watching. · `can_access_committee_area`
- [ ] `ADD` `1-2d` **Your own spot on a committee (self-service)** — At the top of a committee page you see your own roles, and can change which areas you help with, step down as a lead of one area while staying on it, or leave the committee — all without asking anyone. · `set_my_committee_areas`
- [ ] `ADD` `1-2d` **Archived committees & subcommittees (read-only history)** — A committee or subcommittee that's been retired drops out of the live lists but its chat history stays readable, tucked away, and it can be brought back exactly as it was. · `is_committee_area_archived`
- [ ] `ADD` `3-5d` **Create, describe, rename and delete subcommittees (roles)** — An admin adds a subcommittee to a committee, gives it a description, renames it, archives it, or deletes it forever — and each one is its own chat channel. · `add_committee_area`
- [ ] `ADD` `1-2d` **Create, rename and delete committees** — An app admin makes a new committee, edits its name/emoji/description, archives it (reversibly), restores it, or deletes it forever. · `create_committee`
- [ ] `ADD` `3-5d` **Family roster — relatives who aren't on the app yet** — Keeps the whole family's names, emails and phone numbers on file with a house assignment, so they still get every house and resort email, and everything pre-set for them switches on the moment they sign up. · `house_member_recipients`
- [ ] `FINISH` `½d` **Email a whole committee, its leads, or one subcommittee** — One tap drafts an email to everyone on a committee, to just the people running it, or to just one subcommittee — including relatives who don't have an account. · `committee_member_recipients`

## The Family Fest section
[`13-family-fest.md`](ios-parity-2026-08/13-family-fest.md) · 23 items · 130 warnings in the doc

- [ ] `FINISH` `1-2d` **"Anytime all week" things to do** — Things with no set time — the scavenger hunt, merch pickup — listed in their own group instead of pinned to a day. · `fest_schedule_items`
- [ ] `FINISH` `1-2d` **"Happening today" (Day n of N)** — During the week, the top of the fest screen shows every event today plus tonight's dinner in full — time, place, what it is, what to bring, and who to call — so nobody has to dig on the day. · `can_edit_fest`
- [ ] `AUDIT` `1-2d` **Family Fest hub screen** — The one screen that answers 'what is Family Fest and what's happening' — cover photo, name, theme and dates, then today, RSVP, dues, committee contact, and the whole week. · `can_edit_fest`
- [ ] `FINISH` `½d` **The Family Fest season (off-season → planning → live → wrap)** — The whole app quietly changes shape across the year: a quiet banner most months, a 'planning underway' phase from 60 days out, a full 'Day 3 of 7' takeover during the week, and a 'post your photos' tail for two weeks after. · `fest_config`
- [ ] `AUDIT` `3-5d` **The whole week (day-by-day schedule)** — Every day of the fest as a card, each event and that night's dinner expanding in place to its full detail — no drilling into separate pages. · `can_edit_fest`
- [ ] `FINISH` `1-2d` **Chef/lead/crew self-edit of operational details** — Whoever is actually cooking that night or running that event can fix the menu, the time, or the location themselves — without being on the Family Fest committee. · `fest_dinners`
- [ ] `FINISH` `1-2d` **Dinners — the weekly menu** — Reads like a menu posted on the fridge: each night's day, serving time, what's being made, the head chef, and which families are on crew — all visible at once, no tapping. · `can_edit_fest`
- [ ] `FINISH` `½d` **Dues calculator** — Plus/minus steppers per dues tier — '2 adults, 1 kid' — that work out the total and fill in the payment amount and note for you. · `fest_dues`
- [ ] `FINISH` `1-2d` **Family Fest RSVP + per-day picker** — Say whether you're coming and which days, and see how many people are here each day. · `set_event_attendance`
- [ ] `ADD` `1-2d` **Offline-first fest schedule** — The whole week — every event, dinner, menu, location, and phone number — works with no signal at all, which is the normal condition five miles out of Tomahawk. · `fest_config`
- [ ] `FINISH` `1-2d` **Pay screen** — Who to pay for the week and how — a Venmo button pre-filled with the amount and note, a PayPal link, and copyable Zelle / Apple Cash handles. · `fest_payees`
- [ ] `FINISH` `½d` **Single event detail screen** — One event on its own screen — what it is, where, what to bring, who's in charge, its sign-ups and tournament. The target of notification and call-out deep links. · `can_edit_fest`
- [ ] `FINISH` `½d` **"Notify about this change" from the editors** — When an organizer moves dinner to 6:00, they can tell everyone at the fest in the same breath — a banner, an Activity entry, an email, or any combination. · `send_broadcast_notification`
- [ ] `FINISH` `½d` **"See the app as if it's this day"** — A hidden setting that pretends today is a different date, so an organizer can look at the live week or the wrap phase before it happens.
- [ ] `ADD` `½d` **Add the fest week to your calendar** — One tap puts every event and dinner into a Family Fest calendar on your phone, with locations, what to bring, and reminders — so the OS you already trust nudges you. · `fest_schedule_items`
- [ ] `FINISH` `1w+` **Family Fest Planner (the editor)** — Where organizers build the week: add and edit events, dinners, dues tiers, payees, the cover image, and the fest name and dates. · `can_edit_fest`
- [ ] `FINISH` `1-2d` **Family Fest card on Home** — On the resort home screen, one card that changes with the season: a quiet banner most of the year, 'planning underway', today's whole agenda during the week, and a 'post your photos' nudge after. · `fest_config`
- [ ] `FINISH` `3-5d` **Full committee editing, right where the item shows** — An admin or committee member can change an event's or dinner's day, title, time, chef, crew and houses from the schedule itself — no trip to the Planner. · `can_edit_fest`
- [ ] `AUDIT` `¼d` **Lead/chef names that follow a rename** — When someone changes their display name, every event they lead and dinner they cook updates to the new name automatically. · `sync_fest_lead_names`
- [ ] `ADD` `3-5d` **Live Activity + widget for "today at the fest"** — On the Lock Screen during the week: Day 3 of 7, and what's next and where. On the Home Screen the rest of the year: a countdown. · `fest_config`
- [ ] `FINISH` `1-2d` **The parchment / Renaissance look** — Family Fest looks and feels like its own place — aged parchment, sepia ink, heraldic wine and azure, and an inscriptional serif — while the rest of the app stays forest green.
- [ ] `FINISH` `¼d` **Admin-set fest cover photo** — The banner across the top of the Family Fest screen, replaceable by an organizer so both apps update together. · `app_images`
- [ ] `FINISH` `¼d` **Phase-gated shortcuts (dues callout, committee contact)** — A 'pay your dues' row appears in the run-up and disappears once the week starts; a 'contact the Family Fest committee' row appears only during the week. · `fest_dues`

## Verified members (0181–0184), and the smaller catch-up items
[`14-verified-members-and-misc.md`](ios-parity-2026-08/14-verified-members-and-misc.md) · 27 items · 140 warnings in the doc

- [ ] `ADD` `½d` **Verified-member check on your own account** — The app quietly checks whether an admin has okayed your account, and always assumes you are okay whenever it cannot tell. · `is_approved_member`
- [ ] `FINISH` `1-2d` **"Anytime all week" things to do come from the real schedule** — The Anytime-all-week section (scavenger hunt, merch, kids' activities) shows the same up-to-date items the rest of the family sees, instead of a stale copy nobody can edit. · `can_edit_fest`
- [ ] `ADD` `½d` **"You're signed in — almost there" waiting screen** — A newcomer who has signed in but hasn't been okayed by an admin yet sees a friendly explanation instead of an app that looks empty and broken. · `is_approved_member`
- [ ] `ADD` `½d` **A comment held for review disappears until an admin approves it** — If a comment's photo trips the automatic content check, the comment quietly becomes visible only to its author and admins — sometimes a few seconds after it was posted. · `hold_comment_on_flagged_media`
- [ ] `FINISH` `¼d` **Activity feed survives notification kinds it doesn't recognise** — A new kind of notification (like an admin's test ping) shows up harmlessly instead of breaking the whole Activity list. · `notifications`
- [ ] `ADD` `1-2d` **Attach photos and videos to a comment** — You can add photos or videos to a comment on the Main Feed, including a comment that is nothing but a photo. · `post_comments (post_id, author_id, text)`
- [ ] `ADD` `½d` **Close the self-approval loophole (backend SQL, not iOS)** — Stops someone who is waiting for approval from letting themselves in by typing a family member's email address into their own contact details. · `auto_approve_preregistered`
- [ ] `ADD` `½d` **Comment photos shown as a small row of thumbnails** — Photos on a comment appear as small tappable thumbnails inside the thread, and tapping one opens it full screen. · `post_comment_media`
- [ ] `ADD` `½d` **Instant paint of who you are on app open** — The app remembers your name and status on the device so a returning member sees their own view immediately instead of a blank or guest screen. · `profiles`
- [ ] `ADD` `1-2d` **Mute a chat for 1 / 3 / 7 days or until you turn it back on** — You can silence a committee-area chat or your house chat for a set stretch of time, or indefinitely, and one tap un-mutes it. · `set_area_mute`
- [ ] `ADD` `1-2d` **New uploads save their preview image (and survive an older database)** — Every photo or video you upload records its small preview so grids stay fast, and a photo still attaches even if the server is missing the newer fields. · `add_work_item_media`
- [ ] `ADD` `½d` **Photo grids load small previews instead of full-size files** — Scrolling an album or a photo grid is fast because each tile loads a small preview, and the full photo only loads when you tap it. · `post_media`
- [ ] `ADD` `¼d` **Photos and downloads respect the same approval gate** — Someone still waiting on approval can't load or upload photos, and gets the same friendly "almost there" screen rather than an error alert. · `isApprovedMemberByToken`
- [ ] `ADD` `1-2d` **Photos keep their real date and full quality when uploaded from iOS** — A photo you upload from your phone carries the real date it was taken, and the original file is sent so nothing is lost. · `add_drop_box_media `
- [ ] `FINISH` `½d` **Tapping a comment notification jumps to that exact comment** — Tapping a notification about a comment, reply, or mention opens the post and scrolls straight to the comment being talked about, flashing it briefly. · `notif_on_post_comment`
- [ ] `ADD` `¼d` **"🔒 Waiting to be approved" inline chip** — Where a not-signed-in visitor sees a "sign in to see this" chip, someone waiting on approval sees a plain note that they're waiting — with no button to tap. · `profiles`
- [ ] `ADD` `¼d` **Adding a post's photo to an album credits the person who took it** — When an admin adds someone's old post photo into a shared album, the album still shows the original poster as the person who contributed it. · `add_drop_box_media`
- [ ] `ADD` `½d` **Admin can verify or un-verify a member** — An admin sees who is waiting to be okayed and taps a button to let them in — or to take access back. · `set_member_approved`
- [ ] `ADD` `¼d` **Chat photos also use small previews** — Photos sent in committee or house chat load as light previews rather than the full-size file. · `committee_message_media`
- [ ] `ADD` `½d` **Sort an album by when photos were taken** — An album can be ordered by the day the photos were actually taken instead of when they were uploaded, with upload order staying the default. · `add_drop_box_media `
- [ ] `ADD` `½d` **✓ Verified badge with a tap-to-learn-more explainer** — A small checkmark next to a relative's name shows an admin confirmed they're family, and tapping it explains what the checkmark means. · `profiles`
- [ ] `ADD` `¼d` **"Email a group" recipient lists are approval-gated** — The lists of family and admin email addresses used by the email-a-group tool are only handed out to members an admin has verified. · `directory_recipients`
- [ ] `ADD` `½d` **"Notifications confirmed" checklist for admins** — Admins keep a simple checked-off list of family members whose notifications have actually been seen working on their phone. · `set_notification_test_confirmed`
- [ ] `ADD` `¼d` **Admin "view as" preview never shows the admin as unverified** — When an admin previews the app as a guest or another member, their own account never appears to be waiting for approval. · `profiles`
- [ ] `ADD` `½d` **Admin sends a test notification to one member** — An admin can fire a single test alert at one person's phone to check whether notifications reach them, without bothering anyone else. · `send_test_notification`
- [ ] `ADD` `3-5d` **Family roster: family who aren't on the app yet** — Admins keep a list of relatives who don't have an account yet — name, email, phone, which house — so they're linked up automatically the day they sign in. · `link_family_roster`
- [ ] `ADD` `¼d` **Verified counts and a "show only unverified" filter in Admin → Members** — An admin can see at a glance how many people are verified versus waiting, and narrow the list to just the ones needing a decision. · `profiles`

## Conversation search, and media-server behaviours iOS must match
[`15-search-and-media-server.md`](ios-parity-2026-08/15-search-and-media-server.md) · 29 items · 142 warnings in the doc

- [ ] `ADD` `½d` **Photo links are signed so they work in the app** — The app quietly gets a pass from the media server and attaches it to every photo and video link, so pictures load for members and stop working if a link is forwarded outside the family. · `profiles`
- [ ] `FINISH` `½d` **Photos come from the right media server** — Every photo and video is loaded from the family's real media server, so pictures never silently stop appearing.
- [ ] `ADD` `½d` **Photos don't break after a day or on a new phone** — Pictures appear as soon as the app has its pass, and keep working across days, app restarts, and a fresh install — never a screen of broken photos.
- [ ] `ADD` `1-2d` **A whole album finishes uploading** — You can dump a big batch of photos or a long video and it keeps uploading with a progress bar, resuming rather than losing the whole transfer if the connection drops.
- [ ] `ADD` `½d` **Content held for review says so** — If a photo or message gets flagged for an admin to look at seconds after you post it, the app says "held for admin review" instead of claiming everyone can see it. · `hold_content_on_media_verdict`
- [ ] `ADD` `½d` **Photo grids scroll fast and videos show a play badge** — Albums and photo grids show small previews and only load the big file when you tap one, and video tiles are marked with a play badge so you can tell them from photos. · `post_media`
- [ ] `FINISH` `½d` **Photos and videos load and scrub natively** — Photos load and videos seek smoothly using the phone's built-in image loader and player.
- [ ] `FINISH` `¼d` **Photos upload at full original quality** — Your photos are sent exactly as your phone took them, so nobody loses the full-resolution original or the date it was shot.
- [ ] `ADD` `1-2d` **Search all your conversations** — Type a few words and find any message from the family feed, your committee/area chats, or your house chat, then tap the result to jump to it. · `public.search_conversations`
- [ ] `ADD` `½d` **Search keeps up while you type** — Typing in the search box doesn't hammer the server or show stale results from an earlier keystroke.
- [ ] `ADD` `½d` **Search results read correctly** — Each search hit shows the message text and when it was said, without crashing on missing details. · `public.search_conversations`
- [ ] `ADD` `½d` **Search tells you what went wrong** — When a search finds nothing, or the search service is still warming up, the screen says which one it is instead of showing a blank list.
- [ ] `ADD` `½d` **Tapping a search result jumps to the message** — Tapping a search hit opens the right feed post, committee/area chat, or house chat and scrolls to the exact message with a flash. · `posts`
- [ ] `FINISH` `¼d` **The app saves the exact photo link the server returns** — After a photo uploads, the app remembers the link the server gave back so the picture still shows up later. · `post_media`
- [ ] `ADD` `¼d` **Turning on photo-link security without breaking everyone** — The family's photos stay visible while the media server switches from "just watching" to actually requiring signed links. · `apns_subscriptions`
- [ ] `ADD` `½d` **Unapproved accounts can't search the family's posts** — Someone who signed up but hasn't been approved by an admin yet should not be able to read post and comment text through search. · `public.search_conversations`
- [ ] `ADD` `½d` **Upload failures say what actually happened** — If a photo won't upload, the app explains why — your account still needs approval, the server is out of space, or that file type isn't allowed — instead of a generic error. · `profiles`
- [ ] `FINISH` `½d` **Uploaded photos land in the right folder** — A photo you add to a post, a chat, a work item, or a shared album gets filed in the right place on the family's media server.
- [ ] `ADD` `½d` **Uploads record their small preview image** — Every photo or video the app adds also stores the tiny preview the server made for it, so grids can load fast. · `add_work_item_media`
- [ ] `ADD` `1-2d` **Videos keep playing once photo security is enforced** — Videos don't break when the media server starts requiring signed links, even though the phone's player sometimes drops part of the link mid-playback.
- [ ] `ADD` `½d` **Videos keep working after the server re-encodes them** — A video you posted keeps playing even after the media server quietly makes a smaller, more compatible copy of it. · `swapMediaStoragePath`
- [ ] `ADD` `¼d` **A missing or removed photo fails cleanly** — A photo that was deleted, or that lives on a drive that's unplugged, shows a tidy placeholder instead of a broken tile or a crash.
- [ ] `ADD` `½d` **Album photos sort by when they were taken** — Photos in a shared album appear in the order they were actually shot, not the order someone happened to upload them. · `add_drop_box_media`
- [ ] `ADD` `½d` **Save the original photo or video to your phone** — Tapping Save gives you the untouched original file, not the smaller version the app shows on screen.
- [ ] `ADD` `¼d` **Shared-album photos are not held after the fact (backend gap)** — A flagged photo in a shared download folder does not get hidden after it's already been added, unlike everywhere else in the app. · `hold_drop_box_media_on_flagged`
- [ ] `ADD` `¼d` **Captions get a quick check before posting** — Before a caption goes up, the app can quietly ask the server whether the wording is a problem.
- [ ] `ADD` `¼d` **Search results show who said it** — Each search hit shows the name of the person who wrote the message. · `profiles`
- [ ] `ADD` `½d` **Streaming video playlists (not on yet)** — Nothing to build yet — the streaming-playlist version of a video is switched off on the family's server.
- [ ] `ADD` `½d` **Video quality adapts when the server is busy** — When lots of people are watching at once, the app can drop video quality so playback doesn't stall.

## Cross-cutting UX, caching and routing ⚠️ *not fact-checked*
[`17-cross-cutting.md`](ios-parity-2026-08/17-cross-cutting.md) · 54 items · 266 warnings in the doc

- [ ] 🚨 `FINISH` `1-2d` **Guest / waiting-to-be-approved / member gating** — Anyone can browse the app, but private things are hidden until you sign in — and a brand-new signup sees only public content, with a clear explanation, until a family admin okays their account. · `is_approved_member`
- [ ] `ADD` `¼d` **Lead badges and area chips that don't quietly demote people** — The app understands that someone on "Meals · Lead" is also on "Meals", so editing their subcommittees never silently strips their lead standing. · `can_access_committee_area`
- [ ] 🚨 `FINISH` `¼d` **Signing out leaves nothing behind** — When someone signs out on a shared iPad or a borrowed phone, none of their feed, chats, photos or name can paint for the next person.
- [ ] `FINISH` `½d` **Stay signed in, and open already showing your stuff** — A returning member never sees the signed-out version of the app while it loads — their name, avatar and admin tools are there on the first frame. · `profiles`
- [ ] `FINISH` `1-2d` **Tapping a notification lands on the exact thing** — Tapping "Cass commented on your post" opens that post at that comment — not the top of the feed. · `notifications`
- [ ] `ADD` `1-2d` **Three viewer states: guest, signed-in-but-waiting, full member** — The app knows whether you're just browsing, signed in but still waiting for an admin to okay you, or a full member — and shows the right thing for each. · `is_approved_member`
- [ ] `ADD` `½d` **A "Lead" badge on the committee roster** — The roster shows who leads the committee (or one of its subcommittees) at a glance. · `committee_roster`
- [ ] `ADD` `½d` **A deep-linked room opens directly, without flashing the chat list** — Tapping a notification for a committee or house chat opens that room straight away instead of showing the list of chats and then jumping.
- [ ] `ADD` `1-2d` **A tapped notification always lands, even from a cold start** — Whether the app was closed, already open, or you tapped a shared link, you end up on the exact thing you tapped.
- [ ] `ADD` `¼d` **Admin 'view as' never leaves the other person's data behind** — While an admin is looking at the app as someone else, nothing from that view is saved to the device.
- [ ] `ADD` `½d` **Catches up after the app has been in the background** — When you come back to the app after a while it refreshes itself instead of showing yesterday's information.
- [ ] `ADD` `3-5d` **Dark mode** — The app looks right for people whose phone is set to dark — every screen, including the Family Fest section.
- [ ] `ADD` `1-2d` **Fill in your basics (name, phone, birthday, pay method)** — A short optional form so a new member never has to hunt through Settings to add their phone, birthday and how they like to be paid. · `profiles`
- [ ] `ADD` `½d` **First frame after launch is already your content** — Opening the app from cold shows the last content it had straight away, rather than an empty shell that fills in a moment later.
- [ ] `ADD` `1-2d` **First-run welcome sheet for brand-new members** — The very first time someone new gets in, a short guided sheet walks them through turning on notifications and filling in their basics. · `profiles`
- [ ] `ADD` `¼d` **Guests see first names only** — People's full names show to members; a guest only ever sees the first name.
- [ ] `ADD` `1-2d` **Jumps to the exact post, comment or message and highlights it** — After tapping a notification the app scrolls right to the item it was about and briefly highlights it so you can see which one.
- [ ] `ADD` `¼d` **Locked phone numbers, emails and locations** — A single private detail (someone's phone, email or a location) shows as a small lock chip you can tap to sign in, instead of just being missing.
- [ ] `ADD` `½d` **One member's cached data never shows up on another's screen** — Everything the app remembers on the device is filed under whose account it belongs to, so switching accounts can't leak the previous person's screens.
- [ ] `ADD` `1-2d` **Opens already showing your stuff** — When a member reopens the app it comes straight up as their app — no flash of the signed-out version while it checks. · `profiles`
- [ ] `ADD` `½d` **Photos load fast and their access token stays out of the link** — Pictures and videos are cached properly by the phone, and the key that unlocks them never shows up in a link, a log or a screenshot.
- [ ] `ADD` `½d` **Prove the invite link is yours** — If you got in through an admin invite link, the app asks you to type your own email address before letting you in, so a forwarded link can't drop you into someone else's account. · `profiles`
- [ ] `ADD` `3-5d` **Screens show their last known content instantly instead of loading spinners** — Every screen keeps a copy of what it last showed, paints that immediately, and quietly refreshes in the background.
- [ ] `FINISH` `½d` **Scroll to and highlight the item you were sent to** — After a deep link opens a screen, the specific post, comment or message briefly glows so you can see which one it meant.
- [ ] `ADD` `¼d` **Secondary text stays readable for older eyes** — Timestamps, subtitles and helper text are a real readable grey-green rather than faded-out body text.
- [ ] `ADD` `½d` **Signing out wipes the device clean (but keeps your text size)** — Signing out removes every trace of the account's content from the device, while leaving device preferences like text size alone.
- [ ] `ADD` `1-2d` **Tapping a notification knows exactly where to go** — Every notification carries the address of the thing it's about, and the app understands all of those addresses. · `notifications`
- [ ] `ADD` `1-2d` **Text size follows the phone's own setting** — The app's text is as large as the size you already chose in your phone's settings — including the very large accessibility sizes.
- [ ] `ADD` `1-2d` **The app's colour set (pine green, birch, campfire orange)** — Every screen uses the same named resort colours, richer on screens that can show them.
- [ ] `ADD` `½d` **The five bottom tabs** — Home, Feed, Family Fest, Activity and Profile along the bottom, with the current one highlighted.
- [ ] `ADD` `½d` **Turn on notifications during onboarding** — Right after getting in, a new member is asked to turn on phone notifications and can untick the kinds they don't want. · `profiles`
- [ ] `ADD` `½d` **Unread count on the Activity tab** — A little number on the Activity tab shows how many new things there are, counting up as they arrive. · `notifications`
- [ ] `ADD` `½d` **Whole-screen 'sign in to see this' gate** — On members-only screens you get a clear sign-in card (or a 'you're almost there' note) instead of a blank page.
- [ ] `ADD` `3-5d` **A lead can run their own committee's roster from the phone** — Someone who leads a committee can add people, edit a person's name/email/phone, link them to an app account, put them on subcommittees, and make or unmake other leads — for their committee only, never anyone else's. · `is_committee_lead_slug`
- [ ] `ADD` `½d` **Add or drop your own subcommittees** — A plain member can change which subcommittees they're on without asking an admin. · `set_my_committee_areas`
- [ ] `ADD` `1-2d` **Family Fest looks like parchment, the rest of the app looks like the resort** — The Family Fest section has its own warm parchment-and-wine look with a fancier serif, while everything else stays forest green.
- [ ] `ADD` `½d` **Family Fest tab lights up during the fest** — While Family Fest is happening (and just after), its tab gets a pulsing dot and turns the fest's wine colour so you can spot it from anywhere.
- [ ] `ADD` `1-2d` **Fresh data at launch, and a quiet 'what's new'** — The app quietly refreshes in the background so it's up to date when you open it, and after an update it can show a short 'what's new' note.
- [ ] `ADD` `1-2d` **Launch screen holds until the first screen is actually ready** — The app doesn't hand you a half-drawn screen — it stays on the opening screen for a moment until the first screen's content has landed.
- [ ] `ADD` `¼d` **Leave a committee** — Take yourself off a committee entirely — which also correctly removes your access to its chat rooms. · `leave_committee`
- [ ] `ADD` `½d` **Nothing hides under the tab bar and sheets always sit on top** — Content always clears the bottom tab bar, full-screen panels are never trapped behind it, and the keyboard doesn't shove things around.
- [ ] `ADD` `½d` **One '+' button that opens the phone's own photo picker** — Adding a photo or video is a single button that opens the normal iPhone picker — photo library, camera or files — with no extra menu first.
- [ ] `ADD` `1-2d` **Reply from the lock screen without opening the app** — You can tap 'On my way', RSVP, or approve/remove content right on the notification, without opening the app.
- [ ] `ADD` `½d` **Shared links open the app, not Safari** — When someone texts a link to a photo album or a post, it opens in the app instead of the website.
- [ ] `ADD` `½d` **Step down as lead but stay on the crew** — Drop the lead role for one subcommittee while staying on it as a volunteer. · `committee_roster`
- [ ] `ADD` `¼d` **Unread count on the app icon** — The app icon shows how many new things are waiting, the same number as the Activity tab.
- [ ] `ADD` `1-2d` **Works with no signal at the lake** — With no cell service you can still read the feed, the schedule and photos you've already seen.
- [ ] `ADD` `½d` **Your own membership card on the committee page** — A card pinned at the top of a committee page shows what you're on, with the ways to change it in one place. · `committee_roster`
- [ ] `ADD` `½d` **'Please update the app' gate (deliberately not built yet)** — Nothing yet — there is no way for the server to tell old copies of the app that they must update, and for now that's fine. · `resort_config`
- [ ] `FINISH` `¼d` **Fest master editor opens straight in, with no splash or nag** — Opening the Family Fest master editor from the app drops you right into it, without the opening animation or any install prompt.
- [ ] `ADD` `3-5d` **Home-screen widgets** — Small home-screen tiles for who's up north today, the next event, and the countdown to Family Fest.
- [ ] `ADD` `1-2d` **Siri, Spotlight and Handoff** — Screens show up in phone search and can be handed off between devices, and you can ask Siri things like who's up north.
- [ ] `ADD` `¼d` **Taps that actually feel like something** — Small taps and confirmations give a little haptic buzz.
- [ ] `ADD` `½d` **The logo settles into place as the app opens** — The green MLR mark on the opening screen moves into its spot in the header instead of just disappearing.

## Where iOS should be better than the web app
[`18-native-advantages.md`](ios-parity-2026-08/18-native-advantages.md) · 10 items · 76 warnings in the doc

- [ ] `FINISH` `1-2d` **Notifications with the photo in them, a correct badge, and buttons that work** — A push shows the actual photo, groups by chat room, badges the real unread count, and lets you RSVP or mark a task done from the Lock Screen. · `set_event_attendance`
- [ ] `FINISH` `3-5d` **Real photo picking, real capture dates, real originals** — Pick unlimited photos in order, and every one lands with the exact date it was taken and at full resolution. · `add_drop_box_media`
- [ ] `ADD` `1-2d` **The app works on the lake's weak wifi** — The fest schedule, recent photos and the last messages are on the phone, so opening the app in a dead zone shows the app instead of nothing. · `fest_schedule_items`
- [ ] `ADD` `3-5d` **Uploads that keep going when you put the phone away** — Pick 30 photos, lock the phone or switch apps, and the upload finishes anyway instead of dying. · `create_post`
- [ ] `FINISH` `½d` **Albums that scroll smoothly at any size** — A folder with hundreds of photos scrolls like Photos.app instead of hitching. · `drop_boxes`
- [ ] `ADD` `1-2d` **Fest countdown, today's schedule and tonight's dinner on the Home and Lock Screen** — Glance at your phone during fest week and see how many days out it is, what's on today, and what's for dinner and who's cooking. · `fest_config`
- [ ] `ADD` `1-2d` **Share photos from the Photos app straight into an album** — Select photos anywhere on the phone, tap Share, pick MLR, pick a folder — done. · `add_drop_box_media`
- [ ] `ADD` `¼d` **The app taps back** — Buttons, sends, RSVPs and votes give a real physical tick instead of nothing.
- [ ] `FINISH` `1-2d` **Video that plays instantly, adapts to a weak connection, and casts to the TV** — Videos start fast, drop quality instead of stalling on bad signal, keep playing in a corner while you scroll, and AirPlay to the lake-house TV. · `post_media`
- [ ] `ADD` `½d` **Warn before an inappropriate photo is uploaded** — Flags a likely-inappropriate photo on the phone before it uses the lake's uplink, instead of after the mini grades it. · `report_content`
