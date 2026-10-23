// web-coop-keys: "Leave site?" while there is a game to lose. Outside fullscreen no page can stop Ctrl+W (Counter-Strike
// crouch + walk forward) from closing the tab; while this guard is armed the browser asks first instead of closing at
// once. One guard per page, shared by single player and multiplayer:
//   arm(why)     there is something to lose from now on (play.js: the game was entered; coop.js: in a lobby)
//   disarm(why)  not any more (play.js: the page's own error screen is up)
//   leave()      the page itself navigates now (Reload, Rejoin, Try again, Back, Quit): no question, and none later
// The question is the browser's own text, and browsers only show it once the player has clicked or typed on the page.
// The listener exists only while armed (a page that always listens for beforeunload is kept out of the back/forward
// cache). onAsk runs just before the question (play.js lets go of the held keys: the page is frozen while it is up).
// Other modules and the tests reach the same object as globalThis.__kisakLeaveGuard (landing.js and engine.js call
// leave() through it, so a page without a game fetches nothing for it).
function create() {
  const guard = { armed: false, why: null, asked: 0, left: false, onAsk: null, arm, disarm, leave };
  function ask(event) {
    guard.asked++;
    try { guard.onAsk?.(); } catch { /* the question matters more than the hook */ }
    event.preventDefault();
    event.returnValue = true; // browsers from before preventDefault() counted here (Chrome < 119)
  }
  function arm(why = '') {
    if (guard.left || guard.armed) return;
    guard.armed = true; guard.why = why; addEventListener('beforeunload', ask);
  }
  function disarm(why = '') {
    if (!guard.armed) return;
    guard.armed = false; guard.why = why; removeEventListener('beforeunload', ask);
  }
  function leave() { disarm('leave'); guard.left = true; }
  return guard;
}
export const leaveGuard = globalThis.__kisakLeaveGuard ??= create();
