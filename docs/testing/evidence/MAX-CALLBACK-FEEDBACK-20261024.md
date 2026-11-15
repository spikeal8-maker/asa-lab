# Persistent MAX confirmation feedback — 24 October 2026

## Cause and bounded change

The native pairing callback could approve the server-side pairing while sending
only a transient notification. Its original bot message and confirmation button
remained unchanged, leaving the user without a persistent result.

The MAX branch now includes `message: { text, attachments: [] }` in the same
existing `POST /answers?callback_id=…` operation. This edits the message selected
by the native callback and removes its old confirmation keyboard. Both accepted
and refused results remain visible when MAX successfully delivers the update.
Success asks the user to return to ASA Lab and finish or choose the next action;
it does not claim the browser session has already been created.

The official [MAX callback method](https://dev.max.ru/docs-api/methods/POST/answers)
documents `message` as an update of the current message. Its
[NewMessageBody contract](https://dev.max.ru/docs-api/objects/NewMessageBody)
specifies that an empty attachments array removes attachments. No separate
message ID, edit endpoint or additional outgoing message is introduced.

## Security, idempotence and limits

Webhook secret verification, native human-actor selection, pairing expiry,
configuration version, database approval and event deduplication are unchanged.
Identical redelivery sends no second answer and performs no second approval.
The result text contains no pairing token, bot token or client-supplied URL.
Telegram payloads and the transport remain unchanged.

A rejected/stale MAX callback, including HTTP 200 with `success:false`, retains
the existing local-delivery handling: no automatic duplicate-message fallback,
event release or global provider disable. A provider-rejected edit cannot be
claimed visible to the user. Real-device delivery remains a separate acceptance
check; this slice sends no real messages and updates no running installation.

## Verification

One focused run passed all **17 MAX service tests**, including persistent
approved/refused message bodies, keyboard removal, human actor binding,
deduplicated redelivery and unchanged stale-callback health handling. No HTTP
status or existing security expectation was weakened.
