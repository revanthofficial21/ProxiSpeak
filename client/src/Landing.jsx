// The entry screen. Sets the product up in ten seconds, then hands over to the
// office itself.
export default function Landing({ onEnter }) {
  return (
    <main className="landing">
      <div className="landing-hero">
        <p className="landing-eyebrow">Spatial voice for teams</p>
        <h1 className="landing-title">ProxiSpeak</h1>
        <p className="landing-lead">
          An office you can walk through. You hear the people near you and nothing
          else — audio fades with distance, pans with direction, and muffles when
          there is furniture in the way.
        </p>
        <div className="landing-actions">
          <button type="button" className="landing-cta" onClick={onEnter}>
            Enter the office
          </button>
          <span className="landing-hint">
            No install · runs in the browser · microphone only
          </span>
        </div>
      </div>

      <section className="landing-features" aria-label="What it does">
        <article>
          <h2>Proximity audio</h2>
          <p>
            Walk up to a colleague and you are talking. Walk away and you are not.
            No joining, no links, no calls to start.
          </p>
        </article>
        <article>
          <h2>Real spaces</h2>
          <p>
            Open Workspace, Meeting Room, Lounge and more — each one scoped, so a
            conversation never leaks into the next room.
          </p>
        </article>
        <article>
          <h2>Walls that block sound</h2>
          <p>
            Furniture between two people muffles the voice, the way a real room
            does. Most spatial tools let you hear straight through walls.
          </p>
        </article>
        <article>
          <h2>Share your screen</h2>
          <p>
            Present in the Meeting Room to whoever is standing there, alongside the
            conversation.
          </p>
        </article>
      </section>

      <section className="landing-steps" aria-label="How it works">
        <h2>How it works</h2>
        <ol>
          <li>Set a display name and pick an avatar colour.</li>
          <li>Move around with WASD or the arrow keys.</li>
          <li>Enable your microphone — proximity handles the rest.</li>
        </ol>
      </section>

      <footer className="landing-footer">
        <span>ProxiSpeak · proximity-based spatial voice</span>
      </footer>
    </main>
  );
}
