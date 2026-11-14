# Design rules

How Hotaru looks and moves on the TV. Each rule is one the owner asked for, with the reason. Most come from the Mac app's `../gpui-player/DESIGN.md`, where each one's history is recorded; this file says how each applies to a 1920×1080 screen driven by a D-pad, and adds the rules that only the TV has. Sizes are CSS pixels at 1920×1080.

## Focus

- **The D-pad's focus is a 4px ring of 85% white (`box-shadow: 0 0 0 4px rgba(255, 255, 255, .85)`), shown at once, never grown in.** On the TV, focus takes the place of the Mac's hover: whatever the Mac shows under the pointer, such as a card's watched eye (`.corner`), shows on the focused element here.
  Why: from across a room, focus has to be found at a glance, and a ring that grows in lags behind the remote.

- **Focus moves to the nearest focusable element on screen in the pressed direction (`move()` and `nearest()` in `app.js`).** Don't add special cases for one screen's layout.
  Why: details' buttons, a grid's short last row and the letter strip then work without extra code.

- **Choices open as a list to move through, never as a control that cycles through values on each press.** This covers subtitles, and any new choice: audio track, quality, sort order, server.
  Why: a list shows every option at once, and a cycling control hides them.
  <!-- 2026-11-14: a list chosen over a cycling key for subtitles, confirmed as a lasting rule -->

## Surfaces

- **Action buttons are raised keys (`.key`), each set in a recessed track (`.track`).** A toggle that's on shows a bright icon or label (`.on`), never a background. The one exception is Settings' sidebar, where the page showing has a faint background, as on the Mac.
  Why: an action set into a track still reads as one at rest, and a background on a toggle reads as a button rather than a state.

- **A control that holds a value (the search, segmented choices such as seasons) sits in the recessed track:** `#0b0b0c`, an inner shade along the top (`inset 0 2px 4px rgba(0, 0, 0, .8)`) and a 1px highlight under the bottom edge (`0 1px 0 rgba(255, 255, 255, .08)`). The chosen choice is a raised key, and the rest are bare labels.
  Why: one pressed-in look marks every editable value.

- **A card for a film or episode left partway shows how far along its art's foot:** the seek bar's blue on a dark track (`.progress`).
  Why: what's partway through should read at a glance, in any grid or row.

## Color

- **UI text and icons are never pure white.** Main text is 85% white (`rgba(255, 255, 255, .85)`), and secondary information is 45% (`.dim`): a season after the show's name, the play time, a card's detail. Subtitles are the exception: they're white by default, as on the Mac.
  Why: pure white glares against a dark UI over video.

- **Icons drawn over a card's art use a solid colour, not a translucent one:** `#818182`, which is 45% white as it falls on `#1a1a1c`.
  Why: where a translucent icon's strokes cross, the colour doubles up into brighter joins.

## Typography

- **Wrapped text never ends on a single word.** Join the last two words with a no-break space: `noOrphan()` in `app.js`, or ` ` written into a fixed string.
  Why: a lone last word on a line looks unfinished.

## Spacing & layout

- **Rows in a list get room above and below: 20px in Settings, 14px in menus.** Never shrink gaps or padding to avoid scrolling: let the area scroll.
  Why: cramped rows read as cluttered, and scrolling is fine.

- **Settings lists of like rows have a 1px hairline (`rgba(255, 255, 255, .08)`) between each row and the next, and none after the last.**
  Why: it separates rows without boxing them in, and a line under the last row looks like an unfinished list.

- **A page either fits with its full bottom padding or clearly scrolls.** Never let it overflow by a few pixels.
  Why: a sliver of scroll suggests hidden content that isn't there.

- **Cards fill each row's width, and every card in a grid is the same height.** A card's detail always takes its four lines (two for episodes), even when the text is shorter.
  Why: ragged rows read as a broken grid.

## Motion

- **Every scrollable area has edge fades in the area's background colour.** On the TV they're fixed gradients over the area's top and bottom (`#browse::before` and `::after`), not the Mac's timed ones, and they stop short of the scrollbar.
  Why: they show there's content in that direction.

- **Anything that appears once it has loaded fades in from the moment it's ready, over about 0.5–0.6s, and never pops in:** posters, a page's backdrop, the grid. Add the `in` class when the content is ready, and give the element an opacity transition.
  Why: popping in reads as a glitch.

- **Anything still loading after 0.3s shows a spinner, which then holds for at least 0.9s and crossfades into the content.** This covers a page, and a video starting, seeking or buffering. A load that finishes sooner shows no spinner. The first page after signing in shows the app's breathing logo instead, always, for at least 0.9s, and the header fades in with the page. All of this is `busy()` in `app.js`, with `#spinner` and `#preloader` in `index.html`. The spinner is the Mac's playback spinner at TV size: an 85% white ring turning in a dark disc. It sits in the screen's middle, except while the playing overlay's title is up, when it moves to the top right corner under the time, clear of the title.
  Why: popping in reads as a glitch, and so does a loading indicator that flashes up for a moment.

- **Scrubbing shows the seek bar alone.** Left, Right, Rew and FF bring up the playing overlay without its title and poster, or fade them away if they're up. Any other key brings them back.
  Why: while scrubbing, the picture is what you're looking at, and the title covers it.

- **Focus scrolls the page, and nothing else does.** On a page's top row, the page shows from its top, details included. A focused card lower down is centred. A row of people keeps the focused one 80px clear of the screen's edges.
  Why: the D-pad can only move focus, so the scroll has to follow it, and a show's details have nothing to focus.

- **Card effects (the tilt and glimmer on landing, the lit edges and shadow) each have a switch in Settings, General.**
  Why: each one costs a slow TV time on every frame.
