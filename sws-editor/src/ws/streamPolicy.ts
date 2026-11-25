// Whether the live streams (tags, alarms) ever give up (25-11-2026, plan
// docs/plans/2026-11-25-correzioni-collaudo-dev3.md, part A).
//
// A `ReconnectingWs` stops after six unstable connections in a row, about a
// minute. That is right for the IDE: a channel that does not exist must not
// make noise for hours. It is wrong for the viewer of a panel: nobody is in
// front of it to load the page again. On the PLX800 (collaudo of 2.27.0-dev.3)
// the runtime refused connections for two minutes after «delete only the
// project», the tag socket gave up, and the page stayed frozen after the next
// deploy, with the commands lost.
//
// The viewer entry (`main.tsx`) calls `keepStreamsAlive()` before the first
// stream opens. The streams then keep trying every 30 s, without a word; a
// definitive close (4404, 4495) still stops them.

let alive = false;

/** The viewer of a panel: the live streams never give up. */
export function keepStreamsAlive(): void {
  alive = true;
}

/** True after `keepStreamsAlive()`. Read when a stream socket is created. */
export function streamsKeptAlive(): boolean {
  return alive;
}

/** For the tests: back to the default (the streams give up). */
export function resetStreamPolicy(): void {
  alive = false;
}
