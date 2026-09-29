# Shared Cards

*Verified against Kanvaz v9.6.0.*

A Shared Card is the same card, live-linked across multiple boards in
the same `.kanvaz` file — edit it in one place, the change shows up
everywhere it's shared. Useful for a reference asset (a color palette,
a hero shot, a spec sheet) that's relevant to more than one board
without keeping duplicate copies in sync by hand.

## Sharing a card

Right-click a card → **Share to Board…**, pick the target board. The
card gets a visible "shared" badge on every board it's linked from.
Sharing to the currently-active board, or to a board that doesn't
exist, is refused with a clear reason rather than silently doing
nothing.

## Unlinking

Right-click a shared card → **Unlink** turns it back into its own
independent copy on that board only — other boards it's still shared
with are unaffected.

## How it's stored

Shared content lives in a small content registry at the file level
(distinct from any one board's own `cards[]`), keyed by a shared ID.
Each board holds a lightweight instance pointing at that ID, with its
own independent position — moving a shared card on one board doesn't
move it on another, only its *content* is linked. Deleting the last
board instance that references a shared ID prunes the now-unused
registry entry automatically.

## Related

- [Board View](board-view.md) — cards in general
- [MCP Bridge](mcp-bridge.md) — `shareCardToBoard`/`unlinkSharedCard`
  are exposed as MCP tools too
