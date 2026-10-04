import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import LandingNav from "../layout/landingNav";
import SelectDropdown from "../components/SelectDropdown";

// User documentation (/docs), on the landing side of the site like /organizer and /subscriber, so it
// uses LandingNav and never needs a wallet. One page with a sticky table of contents on the left (a
// dropdown on phones). Written for people, not developers: organizers first (they're who chooses
// Velum), then people who receive credentials, then whoever checks a proof. Plain words, no dashes
// in running text, and only what the app does today (see docs/funcionalidades-y-casos-de-uso.md).

const SECTIONS = [
  { id: "getting-started", title: "Getting started", group: "Basics" },
  { id: "recovery-code", title: "Your recovery code", group: "Basics" },
  { id: "credential-types", title: "Types of credentials", group: "Organizers" },
  { id: "create-event", title: "Create an event", group: "Organizers" },
  { id: "organizer-profile", title: "Your organizer profile", group: "Organizers" },
  { id: "invite", title: "Invite people", group: "Organizers" },
  { id: "issue", title: "Issue a credential", group: "Organizers" },
  { id: "holders", title: "Holders and revoking", group: "Organizers" },
  { id: "ask-for-proofs", title: "Ask for proofs", group: "Organizers" },
  { id: "verified", title: "Verified organizers", group: "Organizers" },
  { id: "claim", title: "Claim or receive", group: "People who receive credentials" },
  { id: "my-credentials", title: "Your credentials", group: "People who receive credentials" },
  { id: "prove", title: "Prove something", group: "People who receive credentials" },
  { id: "share", title: "Share your collection", group: "People who receive credentials" },
  { id: "verify", title: "Check a proof", group: "Verifiers" },
  { id: "privacy", title: "What's public, what's private", group: "Reference" },
  { id: "faq", title: "FAQ", group: "Reference" },
];

const GROUPS = [...new Set(SECTIONS.map((section) => section.group))];

const Section = ({ id, title, children }) => (
  <section id={id} className="docs-section">
    <h2 className="docs-section-title">{title}</h2>
    {children}
  </section>
);

const Docs = () => {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);

  // Highlights the section currently near the top of the screen in the table of contents.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const goTo = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Clears the fixed nav, plus the sticky section dropdown when it's showing (phones).
    const mobileToc = document.querySelector(".docs-toc-mobile");
    const tocHeight = mobileToc && getComputedStyle(mobileToc).display !== "none" ? mobileToc.offsetHeight + 16 : 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90 - tocHeight, behavior: "smooth" });
    setActiveId(id);
  };

  return (
    <div className="landing-page docs-page">
      <LandingNav />
      <div className="content-body role-scroll-body">
        <div className="container docs-container">
          <header className="docs-header">
            <span className="role-eyebrow index-hero-eyebrow">Documentation</span>
            <h1 className="docs-title">How Velum works</h1>
            <p className="text-muted docs-lead">
              Everything you need to issue, receive and check private digital credentials. No
              technical background needed.
            </p>
          </header>

          <div className="docs-toc-mobile">
            <SelectDropdown
              id="docs-section"
              value={activeId}
              onChange={goTo}
              options={SECTIONS.map(({ id, title, group }) => ({ value: id, label: `${group}: ${title}` }))}
              ariaLabel="Jump to a section"
            />
          </div>

          <div className="row">
            <aside className="col-lg-3 docs-toc-col">
              <nav className="docs-toc" aria-label="Documentation sections">
                {GROUPS.map((group) => (
                  <div key={group} className="docs-toc-group">
                    <p className="docs-toc-group-title">{group}</p>
                    {SECTIONS.filter((section) => section.group === group).map(({ id, title }) => (
                      <a
                        key={id}
                        href={`#${id}`}
                        className={`docs-toc-link${activeId === id ? " active" : ""}`}
                        aria-current={activeId === id ? "true" : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          goTo(id);
                        }}
                      >
                        {title}
                      </a>
                    ))}
                  </div>
                ))}
              </nav>
            </aside>

            <article className="col-lg-9 docs-content">
              <Section id="getting-started" title="Getting started">
                <p>
                  Velum lets you issue digital credentials (proof of attendance, memberships,
                  certificates) that people can prove without exposing their personal data. It runs
                  on Midnight, a blockchain built for privacy.
                </p>
                <h3>What you need</h3>
                <ul>
                  <li>
                    A Midnight wallet: <strong>Lace</strong> or <strong>1AM</strong>, installed as a
                    browser extension.
                  </li>
                  <li>
                    A small balance of <strong>DUST</strong>, the token that pays Midnight network
                    fees. Checking a proof is free and needs no wallet at all.
                  </li>
                </ul>
                <h3>Connect for the first time</h3>
                <ol>
                  <li>
                    Open the app with <strong>Go to App</strong> and pick your role: Organizer or
                    Subscriber. You can switch any time from the menu.
                  </li>
                  <li>Click the wallet button at the top right and choose your wallet.</li>
                  <li>
                    Velum asks whether you used it with this wallet before. If you did, even on
                    another computer, choose <strong>Yes, restore it</strong> and enter your recovery
                    code. If it's your first time, choose <strong>No, I'm new to Velum</strong>.
                  </li>
                </ol>
                <p className="docs-note">
                  Your Velum identity lives in the browser where you created it, not in the wallet.
                  Using the same wallet elsewhere without restoring creates a second, separate
                  identity that won't see your events or credentials.
                </p>
              </Section>

              <Section id="recovery-code" title="Your recovery code">
                <p>
                  When you start, Velum creates your identity and a recovery code for it. Everything
                  that only lives in your browser (your identity, the private details of your
                  credentials, your proof history and your organizer profile) is encrypted with that
                  code and backed up automatically.
                </p>
                <ul>
                  <li>
                    Save the code from <strong>Backup &amp; Restore</strong>, in the wallet popup. The
                    shield icon turns amber until you do.
                  </li>
                  <li>
                    The backup is encrypted in your browser before it's uploaded. Nobody, including
                    us, can read it without your code.
                  </li>
                  <li>You can also download the backup as a file.</li>
                </ul>
                <p className="docs-note">
                  Without the recovery code, a lost identity can't be recovered. Keep it somewhere safe.
                </p>
              </Section>

              <Section id="credential-types" title="Types of credentials">
                <p>When you create an event you choose its type. It decides who gets a credential and how.</p>
                <div className="docs-table-wrap">
                  <table className="docs-table">
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Who gets it</th>
                        <th>How</th>
                        <th>Good for</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><strong>Event</strong></td>
                        <td>Anyone with access</td>
                        <td>They claim it themselves</td>
                        <td>Conferences, workshops, meetups, concerts</td>
                      </tr>
                      <tr>
                        <td><strong>Subscription</strong></td>
                        <td>Anyone with access</td>
                        <td>They claim it themselves</td>
                        <td>Memberships, communities, followers</td>
                      </tr>
                      <tr>
                        <td><strong>Credential</strong></td>
                        <td>A specific person</td>
                        <td>You issue it to them</td>
                        <td>Diplomas, certificates, tickets, licenses</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  Event and Subscription credentials can be claimed by anyone who finds them, so
                  they're not the right choice for something scarce. For that, use Credential.
                </p>
              </Section>

              <Section id="create-event" title="Create an event">
                <p>
                  In <strong>My Events</strong>, click <strong>Create Event</strong>. A short wizard
                  walks you through it, and every step after the supply is optional.
                </p>
                <ol>
                  <li><strong>Type:</strong> Event, Subscription or Credential.</li>
                  <li><strong>Details:</strong> name, description and the event image.</li>
                  <li>
                    <strong>Supply and dates:</strong> how many credentials can exist (0 means
                    unlimited), an optional deadline, and how long each credential stays valid.
                  </li>
                  <li><strong>Channels:</strong> ways to reach you, like an email or a website.</li>
                  <li><strong>Category details:</strong> format, purpose and similar labels that help people find it.</li>
                  <li><strong>Organizer profile:</strong> your name and, optionally, an address.</li>
                  <li>
                    <strong>Private fields</strong> (Credential only): the details each person's
                    credential will carry, like a grade or an ID number. You choose the type (text,
                    whole number, date or a list of options). Only the field names are public.
                  </li>
                  <li>
                    <strong>POAP image</strong> (Event and Subscription): the image people see on
                    the credential they claim. It's on by default; switch it off to reuse the event
                    image.
                  </li>
                </ol>
                <p>
                  Creating an event is open to anyone and needs no approval. You confirm it in your
                  wallet, and a progress window shows each step until it's on the blockchain.
                </p>
              </Section>

              <Section id="organizer-profile" title="Your organizer profile">
                <p>
                  Your organizer name and address are saved as your profile and filled in for you on
                  every new event. Edit them from <strong>Organizer profile</strong> in the wallet
                  popup, or keep <strong>Save as my organizer profile</strong> on when you create an
                  event.
                </p>
                <p className="docs-note">
                  These details are shown publicly on your events. The profile itself is part of your
                  encrypted backup, so it follows you to other browsers when you restore.
                </p>
              </Section>

              <Section id="invite" title="Invite people">
                <ul>
                  <li>
                    <strong>Event and Subscription:</strong> people find them in{" "}
                    <strong>Explore Events</strong> and claim them there.
                  </li>
                  <li>
                    <strong>Credential:</strong> open the event and use <strong>Invite Link</strong>.
                    Share the link or let the person scan the QR code. When they open it, Velum
                    creates their key for you and gives them a link to send back. That link opens{" "}
                    <strong>Mint POAP</strong> with everything filled in. No keys to copy by hand.
                  </li>
                </ul>
                <p>
                  Received a link back by chat or email? Use <strong>Paste Link</strong> in My
                  Events to open it.
                </p>
              </Section>

              <Section id="issue" title="Issue a credential">
                <p>
                  From a Credential event, click <strong>Mint POAP</strong> (or open the link the
                  person sent you):
                </p>
                <ol>
                  <li><strong>Recipient:</strong> already filled in when you came from their link.</li>
                  <li>
                    <strong>Private details:</strong> this person's values for the event's private
                    fields. They're checked against the field type and limits.
                  </li>
                  <li><strong>Credential image:</strong> the ticket, diploma or document it represents.</li>
                  <li><strong>Icon:</strong> optional, the small image shown on the credential.</li>
                </ol>
                <p>
                  The private details are sent to the recipient encrypted. Only a fingerprint of them
                  is stored on the blockchain. You can't issue a credential to yourself.
                </p>
              </Section>

              <Section id="holders" title="Holders and revoking">
                <p>
                  Open an event to see its holders (Attendees, Subscribers, Followers or Recipients,
                  depending on the type) and a chart of issued, burned and available credentials.
                </p>
                <p>
                  <strong>Revoke</strong> a credential from that list if it was issued by mistake or
                  is no longer valid. It's permanent: the holder still sees it, marked Burned, but
                  can no longer prove anything with it. After revoking, you can issue a new one to
                  the same person.
                </p>
              </Section>

              <Section id="ask-for-proofs" title="Ask for proofs">
                <ul>
                  <li>
                    <strong>Ask for Proof of Ownership:</strong> lets your holders prove they hold a
                    valid credential from your event with a single signature, without revealing who
                    they are.
                  </li>
                  <li>
                    <strong>Ask for a Disclosure</strong> (Credential only): publish a yes/no question
                    about a private field, addressed to one holder (paste the key they give you).
                    Only that holder can answer, and they answer without revealing the value:
                    <ul>
                      <li>Text or list: "is one of …"</li>
                      <li>Number: at least, at most, between, or one of</li>
                      <li>Date: before, after, between, or "at least N years ago" (an age check)</li>
                    </ul>
                  </li>
                </ul>
              </Section>

              <Section id="verified" title="Verified organizers">
                <p>
                  Anyone can create events, and the organizer name on a card is written by the
                  organizer. Two things help people trust who's behind an event:
                </p>
                <ul>
                  <li>
                    <strong>The short key</strong> next to the organizer name. It's the same on every
                    event from the same organizer, whatever name they use.
                  </li>
                  <li>
                    <strong>The Verified badge</strong>, shown for organizers the Velum admin
                    registered after checking who they are.
                  </li>
                </ul>
              </Section>

              <Section id="claim" title="Claim or receive">
                <ul>
                  <li>
                    <strong>Claim:</strong> in <strong>Explore Events</strong>, open an event and
                    click its button (Attend, Subscribe or Follow, depending on the event). Organizers
                    can't claim their own events.
                  </li>
                  <li>
                    <strong>Receive:</strong> open the invite link an organizer sent you. Velum
                    creates your key for that organizer and gives you a link to send back. When they
                    issue your credential, it appears in My Subscriptions on its own.
                  </li>
                </ul>
                <p className="docs-note">
                  You get a different key for each organizer, so two organizers can't tell they have
                  the same person.
                </p>
              </Section>

              <Section id="my-credentials" title="Your credentials">
                <p>
                  <strong>My Subscriptions</strong> lists every credential you hold, including the
                  ones issued to you directly. On each one:
                </p>
                <ul>
                  <li>
                    Private details arrive encrypted, are checked against the blockchain, and stay
                    hidden until you click <strong>Show</strong>.
                  </li>
                  <li>A badge shows whether it's valid, until when, or if it expired.</li>
                  <li><strong>Burn POAP</strong> removes a credential you no longer want. It can't be undone.</li>
                </ul>
              </Section>

              <Section id="prove" title="Prove something">
                <ul>
                  <li>
                    <strong>Prove Ownership:</strong> a public proof that this credential is yours. It
                    shows the credential number, never your wallet.
                  </li>
                  <li>
                    <strong>Prove Ownership Anonymously:</strong> proves you hold a valid credential
                    from that event, without saying which one.
                  </li>
                  <li>
                    <strong>Prove a Private Detail:</strong> answers a question addressed to you,
                    like "are you over 18?", without revealing the value or your wallet. Give the
                    asker your key for questions (shown in the same popup) so they can address it to
                    you; since the question names you, the asker knows the answer is yours. If your
                    value doesn't qualify, the button is disabled.
                  </li>
                </ul>
                <p>
                  Each proof gives you a receipt with a link to share with whoever asked. With fewer
                  than 5 holders, Velum warns you that an anonymous proof is easier to trace back to you.
                </p>
              </Section>

              <Section id="share" title="Share your collection">
                <p>
                  Use <strong>Share my collection</strong> in My Subscriptions to publish a page with
                  the credentials you choose. Hide any of them from the collection first; the rest of
                  your credentials stay private.
                </p>
              </Section>

              <Section id="verify" title="Check a proof">
                <p>
                  Anyone can check a proof at <Link to="/app/verify">/app/verify</Link>, with the
                  link or the transaction code they received. No wallet or account needed.
                </p>
                <p>The page reads the proof straight from the blockchain and shows:</p>
                <ul>
                  <li>whether it's valid, and what exactly was proven, in plain words</li>
                  <li>which event it's about and who asked</li>
                  <li>when it was made, and until when it's valid</li>
                  <li>whether the credential was revoked since</li>
                </ul>
              </Section>

              <Section id="privacy" title="What's public, what's private">
                <div className="docs-table-wrap">
                  <table className="docs-table">
                    <thead>
                      <tr>
                        <th>Information</th>
                        <th>Who can see it</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Event name, image, description, organizer profile</td>
                        <td>Everyone</td>
                      </tr>
                      <tr>
                        <td>How many credentials an event issued</td>
                        <td>Everyone</td>
                      </tr>
                      <tr>
                        <td>Private field names (for example "Grade")</td>
                        <td>Everyone</td>
                      </tr>
                      <tr>
                        <td>Private field values (for example "9")</td>
                        <td>Only the holder, and the organizer who issued it</td>
                      </tr>
                      <tr>
                        <td>Which wallet holds a credential</td>
                        <td>Nobody: holders use a different key with each organizer</td>
                      </tr>
                      <tr>
                        <td>The answer to a proof</td>
                        <td>Whoever checks it, as a yes or no</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Section>

              <Section id="faq" title="FAQ">
                <h3>I don't see my events or credentials on another computer.</h3>
                <p>
                  That browser has a different identity. Open Backup &amp; Restore and restore with
                  your recovery code.
                </p>
                <h3>I lost my recovery code.</h3>
                <p>
                  If the browser where you created your identity still works, open Backup &amp;
                  Restore there to see the code again. Otherwise the identity can't be recovered.
                </p>
                <h3>Can I change my organizer name?</h3>
                <p>
                  Yes, from Organizer profile. New events use the new name; events you already
                  created keep theirs. Your short key stays the same.
                </p>
                <h3>Why can't I claim my own event?</h3>
                <p>Organizers can't claim or issue credentials to themselves.</p>
                <h3>A transaction failed.</h3>
                <p>
                  The progress window explains what went wrong. The most common causes are not
                  enough DUST for the fee, cancelling in the wallet, or the event having expired or
                  run out of credentials.
                </p>
              </Section>
            </article>
          </div>

          <footer className="docs-footer text-muted small">
            © 2026 Velum. Built on Midnight. <Link to="/app">Go to App</Link>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default Docs;
