# Qwixx App Specification

This document is the source of truth for the Qwixx scorekeeper app. Any future rule, layout, state, or style decision should be reflected here before or alongside implementation changes.

## Product Goal

Build a static, installable PWA for tracking a Qwixx game from one player's perspective. The app tracks the user's score card, turn order, row locks, penalties, and final score. It does not synchronize game state between devices. Opponent rolls and opponent row closures are entered manually by the user.

The app should work in an extremely similar way to the sibling `../olvidalo-app/` project:

- Vite, React, and TypeScript.
- Static GitHub Pages deployment.
- PWA manifest and service worker.
- Local-first state using `localStorage`.
- Compact mobile-first layout.
- No routing library unless the project later grows enough to require one.
- Page state managed inside the app, initially only `home` and `play`.

## Pages

The app has exactly two main pages:

1. Home
2. Play

There is no landing page, tutorial page, or marketing content. The first screen is the usable app.

## Home Page

The Home page contains a player section followed by a game section.

### Player Section

The player section should behave like the Olvidalo app's player editor, except there is no per-player out-limit selector.

Required behavior:

- Add players by entering a name and pressing Add.
- Edit player names inline.
- Remove individual players.
- Clear all players.
- Randomize player order.
- Rearrange player order using a drag handle.
- Persist the roster locally.
- Preserve the selected user player when randomizing or rearranging.
- Clear the selected user player if that player is removed.

Each player row includes:

- Drag handle.
- Editable player name.
- Star button to identify which player is the app user.
- Remove button.

The star control is single-select. Exactly one player can be marked as the user. The Start button should be disabled until there is at least one named player and a selected user player.

### Game Section

For now, the Game section contains only a large Start button.

There are no customizable rules on the Home page.

When Start is pressed:

- Trim player names.
- Save the roster and selected user player.
- Clear any previous active game.
- Start on the Play page with the current player set to the first player in the ordered roster.

## Play Page

The Play page contains:

- Top actions.
- Dice section.
- Score card section.
- Live score totals.

### Top Actions

The Play page should include always-present controls for:

- Exit: return to Home and clear the active game, while keeping the saved roster and selected user player.
- Start over: restart the game with the same player order and same selected user player, clearing the score card, locks, penalties, dice state, and game-over state.
- Undo: reset the current uncommitted turn state.

Controls should use icons whenever possible:

- Exit can use an X or back-style icon.
- Start over can use a rotate/reset icon.
- Undo should preferably use a curved back arrow icon and may omit visible text.
- Next should use a forward/down/right movement icon and may omit visible text if the icon is clear.

Use aria labels for icon-only controls.

### Dice Section

The top section of the Play page is the dice section.

It shows the current player's name at the top.

It contains six dice in a 2x3 grid when no rows are closed:

- Column 1: white, white.
- Column 2: red, yellow.
- Column 3: green, blue.

Dice use pips, not numerals.

Dice styling:

- White dice have dark pips.
- Colored dice have colored faces with white pips.
- The dice should feel tactile and large enough to tap comfortably.

If a colored row has been closed, its corresponding colored die disappears completely after the closing turn is committed with Next. White dice are never removed.

Below the dice are 11 white number boxes labeled 2 through 12.

### Dice Stage

No score card control is enabled until the dice stage is complete.

On the user's turn:

- The dice grid is enabled.
- The 2-12 white sum boxes are disabled for clicking.
- Pressing anywhere on the dice grid rolls all visible dice.
- After rolling, the sum of the two white dice is highlighted in the 2-12 boxes.
- Mixed sums are computed from each white die plus each visible colored die.
- The score card selection stage begins.

On an opponent's turn:

- The dice grid is disabled.
- The 2-12 white sum boxes are enabled.
- The user selects the sum of the two white dice based on the opponent's physical roll.
- After the white sum is selected, it is highlighted.
- The score card selection stage begins.

## Score Card Layout

The score card should be an app-native, cleaner, more elegant version of the attached physical score card image. It should preserve the same information without feeling crowded.

Rows:

- Red row: numbers 2 through 12.
- Yellow row: numbers 2 through 12.
- Green row: numbers 12 through 2.
- Blue row: numbers 12 through 2.

Visual order matters. "To the right" means to the right on screen:

- Red and yellow progress from 2 to 12.
- Green and blue progress from 12 to 2.

Each row includes:

- Colored row band.
- White number tiles.
- A divider line between the last two number tiles:
  - Red/yellow: between 11 and 12.
  - Green/blue: between 3 and 2.
- A lock circle after the final number.

Selected number tiles should use a clean black X mark.

## Row Progression Rules

On each row, only numbers visually to the right of the rightmost selected number can be selected.

Examples:

- If red has 2, 4, and 7 selected, only red 8, 9, 10, 11, and 12 can be selected.
- If green has 12, 10, and 8 selected, only green 7, 6, 5, 4, 3, and 2 can be selected.

Closed rows are disabled for the rest of the game.

## Final Number and Lock Rules

The final number in a row is:

- 12 for red and yellow.
- 2 for green and blue.

The final number cannot be selected unless the user already has at least 5 selected numbers in that same row before selecting the final number. Staged selections earlier in the same turn count for this rule.

If the user selects the final number:

- The final number is marked.
- The row's lock icon is automatically marked.
- The lock icon counts as an additional point for that color.
- The row is staged to close.
- The row remains visually present until Next is pressed.
- The corresponding colored die remains visible until Next is pressed.

If an opponent closes a row:

- The user can tap that row's lock icon after the dice stage is complete.
- This stages an opponent lock.
- The row's score controls are immediately disabled for the rest of the current turn.
- The row and corresponding die are not removed until Next is pressed.
- The lock icon does not count as a point for the user.
- Multiple opponent locks may be staged in one turn.

After Next commits any own or opponent row closure:

- The row is disabled for the rest of the game.
- The corresponding colored die disappears for the rest of the game.

If multiple rows close on one turn, all of them are committed together when Next is pressed.

## Selection Rules

The app should prevent illegal moves by disabling controls, not by allowing a move and rejecting it afterward.

At every point in the selection stage:

- Highlight exactly the legal next presses.
- Disable all illegal presses.
- Recompute legal moves after every roll, white-sum selection, score-card selection, penalty selection, and staged lock.
- Keep defensive validation in handlers for stale events or double taps, but the normal UI must not offer illegal moves.

### Opponent Turn Selection

On an opponent turn:

- The user first selects the white dice sum from the 2-12 boxes.
- After that, the user may select zero or one score-card number.
- Any selected score-card number must equal the white sum.
- The selected number must also obey row progression and final-number rules.
- After one score-card number is selected, no further score-card numbers can be selected on that turn.
- The user may also stage one or more opponent row locks after the dice stage is complete.
- Next is enabled as soon as the white sum is selected, even if the user marks no score-card number.

### User Turn Selection

On the user's turn:

- The user first rolls the dice by pressing the dice grid.
- After the roll, the white sum is highlighted.
- The user may select one number, two numbers, or one penalty.

Valid completion states for the user's turn:

- One legal score-card number.
- Two legal score-card numbers, consisting of one white-sum selection and one mixed-sum selection.
- One penalty.

The user cannot combine a penalty with score-card number selections.

The white-sum selection:

- May be in any open row.
- Must equal the sum of the two white dice.
- Must obey row progression and final-number rules.

The mixed-sum selection:

- Uses one white die plus one colored die.
- Must be selected in the row corresponding to that colored die.
- Must obey row progression and final-number rules.
- Only one mixed-sum selection is allowed per user turn.

If two numbers are selected:

- One must be interpretable as the white-sum selection.
- One must be interpretable as the mixed-sum selection.
- The white-sum selection must come first.
- If both selected numbers are in the same row, the visual row order must allow the white-sum mark to be before the mixed-sum mark.

Examples:

- If the white sum is 6 and the red mixed sum is 7, the user can select red 6 and red 7.
- If the white sum is 7 and the red mixed sum is 6, the user cannot select red 6 and red 7, because the white mark would have to come after the mixed mark in that row.

### Ambiguous Selection Logic

Some selected boxes can be both a valid white-sum selection and a valid mixed-sum selection.

The app must not prematurely decide which role an ambiguous box used.

Instead, selection legality should be handled with a legal-interpretations engine:

- At the beginning of the selection stage, enable the union of every legal first press.
- After each press, keep every valid interpretation of the selections so far.
- The next enabled boxes are the union of moves that remain legal under at least one interpretation.
- If a selected box could be white or mixed, preserve both interpretations until later selections force one interpretation or the turn is committed.
- Committing a turn only commits physical marks, penalties, and locks. It does not need to save whether a mark was "white" or "mixed."

If a first selection is ambiguous, the app may still allow an additional selection when at least one valid interpretation allows that second selection.

## Penalty Rules

The user can select penalties only on the user's own turn.

Penalty behavior:

- Max of 4 penalties.
- Each penalty is worth -5 points.
- Selecting a penalty satisfies the user's turn requirement.
- A penalty cannot be combined with score-card number selections.
- If the user reaches 4 penalties, the game is over.

The Play page should also include a small control to indicate that an opponent has reached 4 penalties. Pressing it ends the game.

## Next Button

Next commits the current turn.

Before the dice stage is complete, Next is disabled.

On an opponent turn:

- Next is enabled once the white sum has been selected.
- The user may press Next with zero score-card selections.

On the user's turn:

- Next is enabled only when the staged turn has a valid completion state:
  - One legal number.
  - Two legal numbers with a valid white-plus-mixed interpretation.
  - One penalty.

When Next is pressed:

- Commit all staged marks.
- Commit staged penalties.
- Commit staged own row locks.
- Commit staged opponent row locks.
- Remove dice for newly closed rows.
- Check game-over conditions.
- If the game is not over, advance to the next player in order.

If the current player is the last player, wrap to the first player. There are no rounds to configure.

## Undo Button

Undo resets the current uncommitted turn state.

It applies to:

- Dice roll.
- Opponent white-sum selection.
- Score-card selections.
- Penalty selection.
- Staged own row closures.
- Staged opponent row locks.

Undo does not change committed history after Next has been pressed.

## Game Over

The game ends when any of these conditions becomes true:

- Two rows have been closed globally.
- The user reaches all 4 penalties.
- The user presses the control indicating that an opponent reached 4 penalties.

When the game is over:

- Nothing about the page layout changes.
- Scores remain visible and final.
- The Next button is disabled.
- Exit remains available.
- Start over remains available.

## Scoring

Scoring updates live.

Each color's score is based on the count of selected numbers plus any lock icon earned by the user.

Opponent lock icons do not count for the user.

Scoring guide:

| Mark count | Points |
| ---------- | ------ |
| 1x | 1 |
| 2x | 3 |
| 3x | 6 |
| 4x | 10 |
| 5x | 15 |
| 6x | 21 |
| 7x | 28 |
| 8x | 36 |
| 9x | 45 |
| 10x | 55 |
| 11x | 66 |
| 12x | 78 |

Penalty score:

- Each penalty is -5.
- Four penalties is -20.

Totals display:

- Red total.
- Plus yellow total.
- Plus green total.
- Plus blue total.
- Minus penalty total.
- Equals final total.

The scoring guide and totals should appear below the rows in a cleaner app-native version of the physical score card.

## Persistence

Persist locally:

- Player roster.
- Selected user player.
- Active game state.
- Current page.
- Current player index.
- Score-card marks.
- Own locks.
- Opponent locks.
- Closed rows.
- Penalties.
- Current uncommitted turn state.
- Game-over state.

Suggested storage keys:

- `qwixx.players.v1`
- `qwixx.selectedPlayer.v1`
- `qwixx.activeGame.v1`

Restoring the app should resume the active game as it appeared before refresh or app close.

Exit clears the active game state but keeps roster and selected user player.

Start over replaces the active game state with a fresh game using the current game players and selected user player.

## PWA and Deployment

The app should follow the Olvidalo app's static deployment pattern:

- Vite config uses `base: "./"` for GitHub Pages compatibility.
- Production build runs TypeScript and Vite build.
- Service worker caches the app shell and built assets.
- Manifest uses the app name `Qwixx`.
- GitHub Actions deploys `dist` to GitHub Pages on push to `main`.

## Visual Style

The style should be colorful, simple, minimal, and clean.

Theme target:

- "Kindergarten / living-room dice game" in spirit.
- Friendly and tactile.
- More elegant than childish.
- Not crowded.
- Not rustic, outdoorsy, or niche like Olvidalo.

Overall look:

- White or near-white background.
- Very light gray panel boundaries.
- Minimal shadows.
- 8px border radius or less unless a round control is semantically circular.
- No gradients, decorative blobs, or illustrative backgrounds.
- The Qwixx row colors and dice colors provide the personality.

Color approach:

- Red, yellow, green, and blue should be clear and saturated enough to identify rows and dice.
- Supporting UI should use white, light gray, charcoal, and restrained accent colors.
- Avoid a one-note palette dominated by one hue.

Typography:

- Clean system or Inter-style sans-serif.
- Strong readable numerals.
- No playful display font unless explicitly chosen later.
- Do not scale fonts with viewport width.
- Letter spacing should remain 0.

Controls:

- Prefer icons over visible text when the icon is familiar.
- Use lucide icons where available.
- Use visible text only where it materially improves clarity.
- Provide aria labels for icon-only controls.
- Disabled controls should be visibly disabled.

Dice:

- Large, tappable, rounded square dice.
- Pips instead of numerals.
- Colored dice use white pips.
- White dice use dark pips.
- A small restrained roll animation is acceptable.

Score card:

- App-native and elegant, not a literal copy of the photo.
- Colored row bands with white number tiles.
- Bold black X for selected marks.
- Lock circles should be visually clear but compact.
- The score card should remain readable on mobile without feeling cramped.

Layout:

- Mobile-first, similar width and density to Olvidalo.
- Avoid nested cards.
- Use full-width sections with constrained inner content.
- The dice section should feel like the primary interaction area.
- The score card should be compact but airy.
- Text should never overflow, overlap, or crowd controls.

## Verification Expectations

Before considering an implementation complete:

- Run the production build.
- Verify the Home player controls match the agreed behavior.
- Verify the Play page at mobile and desktop widths.
- Verify dice rolling and manual white-sum selection.
- Verify legal move highlighting and disabled illegal moves.
- Verify ambiguous selections remain valid until forced.
- Verify row closing, staged locks, die removal after Next, and multiple row closures.
- Verify scoring, penalties, and game-over conditions.
- Verify reload persistence.
- Verify PWA build output and service worker generation.
