/**
 * The opening words. Rendered twice on purpose: once by the server, so they
 * are on screen before a single byte of 3D has arrived, and again by the
 * live interface in exactly the same place, so the hand-off is invisible.
 */
export function Masthead() {
  return (
    <>
      <p className="brand">Bappa 2026</p>
      <h1 className="headline">
        Leave something
        <br />
        with Bappa.
      </h1>
      <p className="litany">A wish. A gratitude. A burden. A promise.</p>
      <p className="support">He becomes what we leave behind.</p>
    </>
  );
}
