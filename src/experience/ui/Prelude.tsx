import { Masthead } from './Masthead';

/**
 * What a visitor sees before the experience has loaded: the premise, and a
 * single small flame where he will be. No progress bar and no spinner --
 * a diya lit in the dark before the murti is revealed.
 *
 * Server-rendered, so it paints with the HTML. Hidden the moment the live
 * interface takes over (html[data-live]).
 */
export function Prelude() {
  return (
    <div className="prelude">
      <header className="layer layer--masthead in">
        <Masthead />
      </header>
      <div className="ember in" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
