import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import {
  Ticket,
  QrCode,
  Calendar,
  Users,
  Lock,
  GraduationCap,
  Award,
  ScrollText,
  Star,
  Heart,
  FileCheck,
  Fingerprint,
  PlusCircle,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import LandingNav from "../layout/landingNav";
import { useSiteRole, SITE_ROLES } from "../hooks/useSiteRole";
import adasoulsLogo from "../../images/adasouls.png";

// Each use case now carries three related icons (instead of one) — rendered as an overlapping
// collage by UseCaseCollage below rather than a single centered glyph. Order matters: [0] is the
// largest/frontmost tile, [1] and [2] recede in size and z-index (see .tile-0/1/2 in
// theme-dark-glass.css).
const USE_CASES = [
  {
    icons: [Ticket, Calendar, QrCode],
    role: "organizer",
    title: "Event attendance",
    description: "Give attendees lasting proof they were there: conferences, workshops, meetups, concerts.",
  },
  {
    icons: [GraduationCap, Award, ScrollText],
    role: "subscriber",
    title: "Diplomas & certificates",
    description:
      "Issue certificates with private details, like a grade or an expiry date. The holder can prove they passed without showing the grade.",
  },
  {
    icons: [Users, Heart, Star],
    role: "organizer",
    title: "Memberships & communities",
    description:
      "Members prove they belong to your club, community or subscription, without telling anyone who they are.",
  },
  {
    icons: [Lock, Fingerprint, FileCheck],
    role: "subscriber",
    title: "Access & age checks",
    description: "Check that someone holds a valid pass, or is over 18, without asking for their ID.",
  },
];

// The three steps of the "How it works" slide. Colors alternate by role like the use cases do.
const STEPS = [
  {
    icon: PlusCircle,
    role: "organizer",
    title: "Create",
    description:
      "Set up an event, course or membership in a few minutes: name, image, how many credentials, and until when.",
  },
  {
    icon: QrCode,
    role: "subscriber",
    title: "Invite",
    description: "Share a link or a QR code. People claim their credential, or you issue it to them directly.",
  },
  {
    icon: ShieldCheck,
    role: "organizer",
    title: "Verify",
    description:
      "Anyone can confirm a credential is genuine and ask a yes/no question about it, like “is it still valid?”, without seeing the rest.",
  },
];

// One dot-nav entry per full-screen section: the intro, how it works, one per use case (each its
// own full-screen slide — see UseCaseRow below), then privacy, the subscriber path and the closing
// call to action. Index into this array is the same index used for sectionRefs/activeIndex in
// Dashboard.
const SECTION_LABELS = [
  "Intro",
  "How it works",
  ...USE_CASES.map((useCase) => useCase.title),
  "Privacy",
  "Received a credential?",
  "Get started",
];
const FIRST_USE_CASE_INDEX = 2;
const AFTER_USE_CASES_INDEX = FIRST_USE_CASE_INDEX + USE_CASES.length;

const COLLAGE_BACK_PARTICLE_COUNT = 14;
const COLLAGE_FRONT_PARTICLE_COUNT = 10;

// Small deterministic PRNG (mulberry32) so each row's particle field is stable across re-renders
// (no layout jitter on every scroll-driven re-render) but still differs row-to-row — seeded from
// that row's own icon set rather than Math.random().
function seededRandom(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// Shared by every particle layer (UseCaseCollage's back/front fields, HeroBackdrop's field) — same
// shape, different seed/count per layer/row so neither field repeats another's pattern or jitters
// between re-renders. `colors`, when passed, assigns each particle one (randomly, via the same
// seeded stream) of the given colors, returned as `color` — used by HeroBackdrop to mix in both
// role accent colors, since a hero particle has no role context to inherit --role-accent from the
// way UseCaseCollage's particles do (those omit `colors` and just rely on .usecase-particle's own
// CSS `background: var(--role-accent)`).
function buildParticleField(seed, count, colors) {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => ({
    key: i,
    top: `${Math.round(rand() * 100)}%`,
    left: `${Math.round(rand() * 100)}%`,
    size: 3 + Math.round(rand() * 4),
    duration: 4 + rand() * 3,
    delay: rand() * 4,
    color: colors ? colors[Math.floor(rand() * colors.length)] : undefined,
  }));
}

// Shared by every section's reveal. The spring trails the raw scroll position slightly, so
// elements ease into place instead of tracking each scroll frame one-to-one, and the fade now spans
// a wider stretch of the scroll (0.22–0.4 in, 0.6–0.78 out) instead of popping in over a short one.
const REVEAL_SPRING = { stiffness: 70, damping: 22, mass: 0.6, restDelta: 0.001 };
const REVEAL_OPACITY_STOPS = [0, 0.22, 0.4, 0.6, 0.78, 1];

// Same fade/slide curve used by every full-screen section (hero, role picker, each use case) for
// a consistent scroll-linked enter/exit: flat+invisible while far from the viewport, ramps in
// approaching center, holds through a small dwell zone around dead-center, then ramps back out —
// see the two big comments further down (originally on UseCaseRow, now shared) for why the dwell
// zone and the separate ramp windows exist.
//
// `containerRef` MUST be passed and point at .landing-snap-scroller (not the window) — framer-
// motion's useScroll tracks window scroll by default, but that page never scrolls here (the
// scroller is its own overflow:auto viewport nested inside a 100vh page), so every section's
// scrollYProgress would otherwise freeze at whatever value it happened to compute on mount, never
// updating as the user scrolls the actual (inner) container. That's what caused every section
// after the first to render permanently invisible (opacity stuck at its frozen initial value) and
// contributed to a page-wide horizontal scrollbar (UseCaseRow's icon/text columns stuck at their
// extreme slide-in offset instead of animating back to 0 — see .landing-snap-scroller's own
// overflow-x: hidden in theme-dark-glass.css for the other half of that fix).
function useSectionReveal(ref, containerRef) {
  const { scrollYProgress: rawProgress } = useScroll({ target: ref, container: containerRef, offset: ["start end", "end start"] });
  const scrollYProgress = useSpring(rawProgress, REVEAL_SPRING);
  const y = useTransform(scrollYProgress, [0, 0.4, 0.6, 1], [36, 0, 0, -36]);
  const opacity = useTransform(scrollYProgress, REVEAL_OPACITY_STOPS, [0, 0, 1, 1, 0, 0]);
  return { scrollYProgress, y, opacity };
}

// Replaces the old single centered icon with three overlapping tiles (front-to-back, sized and
// positioned via .tile-0/1/2 in theme-dark-glass.css) plus two drifting particle fields — one
// behind the tiles, one above them (z-index only; see .usecase-particle-front in
// theme-dark-glass.css) — so particles read as floating through the collage, not just sitting
// behind it. Each tile is two nested elements on purpose: the outer one rides the row's own
// scroll progress (via `style.y` bound directly to a useTransform of it) for scroll-linked depth
// parallax, while the inner one runs its own infinite idle float/rotate via `animate` — a
// MotionValue driving `style.y` and an `animate` loop can't both target the same key on the same
// element, so idle motion lives one level down instead of colliding with the scroll-linked one.
const UseCaseCollage = ({ icons, role, scrollYProgress, iconLeft }) => {
  const [IconA, IconB, IconC] = icons;
  const iconSeedKey = icons.map((Icon) => Icon.displayName || Icon.name).join("|");

  const backParticles = useMemo(
    () => buildParticleField(hashSeed(`${iconSeedKey}|back`), COLLAGE_BACK_PARTICLE_COUNT),
    [iconSeedKey]
  );
  const frontParticles = useMemo(
    () => buildParticleField(hashSeed(`${iconSeedKey}|front`), COLLAGE_FRONT_PARTICLE_COUNT),
    [iconSeedKey]
  );

  // Front tile barely moves, back tiles drift further — makes the three icons visibly separate in
  // depth as the row scrolls through its reveal window instead of just floating in place together.
  const tile0Y = useTransform(scrollYProgress, [0, 0.5, 1], [18, 0, -18]);
  const tile1Y = useTransform(scrollYProgress, [0, 0.5, 1], [46, 0, -46]);
  const tile2Y = useTransform(scrollYProgress, [0, 0.5, 1], [-54, 0, 54]);

  return (
    <div className={`usecase-collage role-${role}`}>
      {/* .usecase-collage itself (the box above) never moves — its size/position in the grid
          column is unchanged regardless of which side of the row the icon is on. This inner
          wrapper is what shifts (via .usecase-collage-content-shift-left below) when the icon
          column is on the LEFT: only the rendered content (tiles + particles) nudges left within
          the same-sized, same-positioned box, per explicit feedback that the container itself
          must stay put. */}
      <div className={`usecase-collage-content${iconLeft ? " usecase-collage-content-shift-left" : ""}`}>
      {backParticles.map((p) => (
        <span
          key={`back-${p.key}`}
          className="usecase-particle"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      <motion.div className="usecase-collage-tile-wrap tile-2" style={{ y: tile2Y }}>
        <motion.div
          className="usecase-collage-tile"
          animate={{ y: [0, 14, 0], rotate: [-14, -6, -14] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        >
          <IconC size={60} />
        </motion.div>
      </motion.div>

      <motion.div className="usecase-collage-tile-wrap tile-1" style={{ y: tile1Y }}>
        <motion.div
          className="usecase-collage-tile"
          animate={{ y: [0, -12, 0], rotate: [10, 18, 10] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        >
          <IconB size={76} />
        </motion.div>
      </motion.div>

      <motion.div className="usecase-collage-tile-wrap tile-0" style={{ y: tile0Y }}>
        <motion.div
          className="usecase-collage-tile"
          animate={{ y: [0, -10, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
        >
          <IconA size={104} />
        </motion.div>
      </motion.div>

      {frontParticles.map((p) => (
        <span
          key={`front-${p.key}`}
          className="usecase-particle usecase-particle-front"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
      </div>
    </div>
  );
};

// A representative icon from each use case (the front/tile-0 icon of each collage — see
// USE_CASES), reused here as a loose backdrop behind the hero text rather than introducing a
// separate icon set. Deliberately not the full 21-icon USE_CASES set — that many would read as
// clutter at hero scale, one per category is enough to hint "this is what the icons below are".
const HERO_BACKDROP_ICONS = USE_CASES.map((useCase) => useCase.icons[0]);
const HERO_BACKDROP_ICON_COUNT = 14;
const HERO_BACKDROP_PARTICLE_COUNT = 32;

// The two role accent colors (.role-organizer/.role-subscriber's own --role-accent in
// theme-dark-glass.css), hardcoded here rather than read from a CSS variable — the hero has no
// role-organizer/-subscriber ancestor to inherit --role-accent from (it's role-neutral), same
// reasoning as .index-hero-eyebrow's gradient already hardcoding these same two hex values.
const ROLE_COLORS = ["#b24bf3", "#3ecf8e"];

// Large blurred drifting color blobs behind everything else in the hero (rendered first, see
// HeroBackdrop) — art-directed rather than seeded-random: only 3 of them, so hand-placed positions
// read more deliberate than a random scatter would at this size. Alternating role colors, not a
// strict 50/50 mechanical split. Bumped bigger (was 360-480px) and gained a `rotate` range per
// explicit ask for "more movement" — combined with BLOB_RADII's morph below, each blob now
// drifts, rotates, AND reshapes simultaneously instead of just drifting.
const HERO_BLOBS = [
  { color: ROLE_COLORS[0], top: "18%", left: "12%", size: 640, driftX: 90, driftY: 70, rotate: 70, duration: 26 },
  { color: ROLE_COLORS[1], top: "60%", left: "82%", size: 580, driftX: -80, driftY: 80, rotate: -110, duration: 30 },
  { color: ROLE_COLORS[0], top: "82%", left: "24%", size: 500, driftX: 70, driftY: -60, rotate: 90, duration: 23 },
];

// Organic (not circular) shape, morphing through these four `border-radius` keyframes in a loop
// (the last matches the first so the loop has no visible seam) — replaces a flat `border-radius:
// 50%` per explicit ask for "formas más amorfas, no solo círculos desenfocados". Shared across all
// three blobs (their different size/duration/rotate/drift already keeps them visually distinct;
// they don't also need independent morph shapes).
const BLOB_RADII = [
  "42% 58% 65% 35% / 45% 40% 60% 55%",
  "58% 42% 38% 62% / 55% 65% 35% 45%",
  "48% 52% 55% 45% / 60% 45% 55% 40%",
  "42% 58% 65% 35% / 45% 40% 60% 55%",
];

// Same idea as buildParticleField's depth-free field, but each icon also gets a continuous
// "depth" value (0 = far, 1 = near) driving size/blur/opacity together, so the field reads as
// icons scattered at different distances behind the text rather than one flat layer — some
// larger and sharper, some smaller and out of focus further back, per explicit ask.
function buildHeroIconField(seed, count) {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const depth = rand();
    return {
      key: i,
      Icon: HERO_BACKDROP_ICONS[i % HERO_BACKDROP_ICONS.length],
      top: `${Math.round(rand() * 100)}%`,
      left: `${Math.round(rand() * 100)}%`,
      size: Math.round(30 + depth * 52),
      blur: Math.round((1 - depth) * 5),
      opacity: 0.07 + depth * 0.15,
      duration: 7 + rand() * 6,
      // Pause between one appear→float→disappear cycle and the next — without this the fade
      // cycle just loops back-to-back forever, which reads the same as a continuous bounce (the
      // exact thing being fixed here) instead of the icon genuinely going away for a while.
      gapDuration: 3 + rand() * 5,
      delay: rand() * 5,
      driftY: 14 + rand() * 20,
      rotateFrom: -12 - rand() * 10,
      rotateTo: 12 + rand() * 10,
    };
  });
}

// Floating blobs + icons + particles behind the hero text (index.jsx's HeroSection) —
// pointer-events:none and rendered before .container in the DOM so it paints behind the real hero
// content without needing an explicit z-index. Reuses the same seeded-PRNG approach as
// UseCaseCollage's particle fields (buildParticleField) so the field is stable across re-renders
// instead of reshuffling. Render order inside the div is back-to-front: blobs, then icons, then
// particles — DOM order is paint order here (no z-index needed, same stacking context).
const HeroBackdrop = () => {
  const icons = useMemo(
    () => buildHeroIconField(hashSeed("hero-backdrop-icons"), HERO_BACKDROP_ICON_COUNT),
    []
  );
  const particles = useMemo(
    () => buildParticleField(hashSeed("hero-backdrop-particles"), HERO_BACKDROP_PARTICLE_COUNT, ROLE_COLORS),
    []
  );

  return (
    <div className="hero-backdrop" aria-hidden="true">
      {HERO_BLOBS.map((blob, i) => (
        // Same two-level nesting as the icons below (and UseCaseCollage's tiles): the outer plain
        // <div> anchors position via a CSS `transform: translate(-50%,-50%)`, the inner motion.div
        // does the drift via `animate={{x,y}}` — a motion.* element fully owns `style.transform`
        // once any motion value targets it, which would silently drop the CSS one if combined on
        // the same element.
        <div key={i} className="hero-backdrop-blob-anchor" style={{ top: blob.top, left: blob.left }}>
          <motion.div
            className="hero-backdrop-blob"
            style={{
              width: blob.size,
              height: blob.size,
              background: `radial-gradient(circle, ${blob.color}55, transparent 70%)`,
            }}
            animate={{
              x: [0, blob.driftX, 0],
              y: [0, blob.driftY, 0],
              rotate: [0, blob.rotate, 0],
              borderRadius: BLOB_RADII,
            }}
            transition={{ duration: blob.duration, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      ))}

      {icons.map((item) => {
        const { Icon } = item;
        return (
          // Two nested elements, same reason as UseCaseCollage's tiles: the outer does the CSS
          // `transform: translate(-50%,-50%)` centering (theme-dark-glass.css) so each icon
          // centers on its top/left percentage point — a motion.* element that animates x/y/
          // rotate/scale fully owns `style.transform` once any of those target it, which would
          // silently drop that CSS rule. This outer IS a motion.div (unlike the plain <div> the
          // earlier bounce-loop version used) because it now animates `opacity` — but opacity
          // isn't a transform-related property, so framer-motion leaves `style.transform` alone
          // and the CSS positioning transform survives untouched.
          <motion.div
            key={item.key}
            className="hero-backdrop-icon"
            style={{
              top: item.top,
              left: item.left,
              filter: item.blur ? `blur(${item.blur}px)` : undefined,
            }}
            // Appear → hold-while-floating → disappear → pause → repeat, not a bounce that never
            // actually leaves — `times` keys the two middle 0/1 values to the same instants as the
            // inner motion.div's own position/rotate cycle below (25%/75% through `duration`) so
            // the icon fades in exactly as it starts drifting and fades out exactly as that drift
            // returns to its start, then `repeatDelay` is what makes it genuinely vanish for a
            // while instead of looping straight back into the next fade-in.
            animate={{ opacity: [0, item.opacity, item.opacity, 0] }}
            transition={{
              duration: item.duration,
              times: [0, 0.25, 0.75, 1],
              repeat: Infinity,
              repeatDelay: item.gapDuration,
              delay: item.delay,
              ease: "easeInOut",
            }}
          >
            <motion.div
              animate={{ y: [0, -item.driftY, 0], rotate: [item.rotateFrom, item.rotateTo, item.rotateFrom] }}
              transition={{
                duration: item.duration,
                repeat: Infinity,
                repeatDelay: item.gapDuration,
                delay: item.delay,
                ease: "easeInOut",
              }}
            >
              <Icon size={item.size} />
            </motion.div>
          </motion.div>
        );
      })}

      {particles.map((p) => (
        <span
          key={`hero-particle-${p.key}`}
          className="usecase-particle hero-backdrop-particle"
          style={{
            top: p.top,
            left: p.left,
            width: p.size,
            height: p.size,
            // Inline, not a CSS class rule — always wins regardless of stylesheet source order
            // (the class-based version of this color override, .hero-backdrop-particle, was once
            // silently losing to .usecase-particle's own `background: var(--role-accent)` because
            // both are single-class selectors and .usecase-particle happens to be declared later
            // in theme-dark-glass.css; inline style has no such ordering ambiguity).
            background: p.color,
            boxShadow: `0 0 6px ${p.color}66`,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

// The intro slide — full-screen (see .landing-snap-section in theme-dark-glass.css), forwards its
// ref both as the DOM node the parent's IntersectionObserver/dot-nav scrollIntoView target AND as
// the useScroll target for its own reveal, same dual-purpose pattern every section below uses.
const HeroSection = React.forwardRef(({ scrollerRef }, ref) => {
  const { y, opacity } = useSectionReveal(ref, scrollerRef);

  return (
    <section ref={ref} className="landing-snap-section index-hero-section">
      <HeroBackdrop />
      <div className="container">
        <motion.div className="index-hero" style={{ y, opacity }}>
          <span className="role-eyebrow index-hero-eyebrow">Private digital credentials</span>
          <h1 className="role-hero-title index-hero-title">
            Credentials you can prove, privately
          </h1>
          <p className="text-muted role-hero-desc index-hero-desc">
            Certificates, event attendance, memberships and access passes. You create them, your
            attendees keep them, and anyone can check they're real without seeing personal details.
          </p>
          {/* Organizer first: the organizer is who chooses Velum, so theirs is the one main button.
              People who received a credential mostly arrive through a link, so they get a small
              secondary link instead of an equal button. */}
          <div className="index-hero-actions">
            <Link to="/organizer" className="btn btn-role-cta role-organizer">
              <PlusCircle size={16} className="mr-2" />
              Start issuing
            </Link>
          </div>
          <Link to="/subscriber" className="index-hero-secondary-link role-subscriber">
            Received a credential? See yours
          </Link>
        </motion.div>

        <motion.div
          className="index-scroll-hint"
          style={{ opacity }}
          animate={{ y: [0, 10, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <ChevronDown size={28} />
        </motion.div>
      </div>
    </section>
  );
});
HeroSection.displayName = "HeroSection";

// "How it works" slide — the three steps an organizer goes through. Same full-screen + reveal
// treatment as HeroSection above.
const HowItWorksSection = React.forwardRef(({ scrollerRef }, ref) => {
  const { y, opacity } = useSectionReveal(ref, scrollerRef);

  return (
    <section ref={ref} className="landing-snap-section index-steps-section">
      <div className="container">
        <motion.div style={{ y, opacity }}>
          <div className="index-section-header index-section-header-compact">
            <h4 className="mb-1">How it works</h4>
          </div>

          <ol className="row index-steps-row list-unstyled">
            {STEPS.map(({ icon: Icon, role, title, description }, i) => (
              <li key={title} className={`col-md-4 index-step role-${role}`}>
                <Icon size={64} className="index-role-plain-icon index-step-icon" />
                <div>
                  <h5 className="mb-1">
                    <span className="index-step-number">{i + 1}.</span> {title}
                  </h5>
                  <p className="text-muted small index-step-desc">{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </motion.div>
      </div>
    </section>
  );
});
HowItWorksSection.displayName = "HowItWorksSection";

// Privacy explained with one concrete example instead of the cryptography behind it.
const PrivacySection = React.forwardRef(({ scrollerRef }, ref) => {
  const { y, opacity } = useSectionReveal(ref, scrollerRef);

  return (
    <section ref={ref} className="landing-snap-section index-text-section">
      <div className="container">
        <motion.div className="index-text-block" style={{ y, opacity }}>
          <ShieldCheck size={64} className="index-text-icon index-text-icon-dual" />
          <h4 className="index-text-title">Share the proof, not your data</h4>
          <p className="text-muted index-text-desc">
            Proving something usually means handing over a document that says far more than needed.
            With Velum, a credential's private details stay with the person who holds it. Whoever
            checks gets a yes or a no. Nothing else.
          </p>
          <p className="index-text-example">
            A venue can confirm a guest is over 18 without learning their birth date.
          </p>
          <p className="text-muted small mb-0">
            Built on Midnight, a blockchain designed for privacy, so credentials can't be forged or
            quietly changed.
          </p>
        </motion.div>
      </div>
    </section>
  );
});
PrivacySection.displayName = "PrivacySection";

// The subscriber's path: most arrive through a link an organizer sent, so this is one short slide
// rather than a role of equal weight on the first screen.
const ReceivedSection = React.forwardRef(({ scrollerRef }, ref) => {
  const { y, opacity } = useSectionReveal(ref, scrollerRef);
  const [, setRole] = useSiteRole();

  return (
    <section ref={ref} className="landing-snap-section index-text-section">
      <div className="container">
        <motion.div className="index-text-block role-subscriber" style={{ y, opacity }}>
          <Award size={64} className="index-text-icon index-role-plain-icon" />
          <h4 className="index-text-title">Received a credential?</h4>
          <p className="text-muted index-text-desc">
            Open the link you were sent and connect a Midnight wallet (Lace or 1AM). Everything you
            receive shows up in one place, and you decide what to share.
          </p>
          <Link
            to="/app/my-subscriptions"
            className="btn btn-role-cta"
            onClick={() => setRole(SITE_ROLES.SUBSCRIBER)}
          >
            See my credentials
          </Link>
        </motion.div>
      </div>
    </section>
  );
});
ReceivedSection.displayName = "ReceivedSection";

const ClosingSection = React.forwardRef(({ scrollerRef }, ref) => {
  const { y, opacity } = useSectionReveal(ref, scrollerRef);

  return (
    <section ref={ref} className="landing-snap-section index-text-section">
      <div className="container">
        <motion.div className="index-text-block" style={{ y, opacity }}>
          <h4 className="index-text-title">Ready to issue your first credential?</h4>
          <p className="text-muted index-text-desc">Set up your first event in a few minutes.</p>
          <Link to="/app" className="btn btn-dual-cta btn-glow-border btn-glow-hover">
            <span className="btn-glow-fill" aria-hidden="true" />
            <span className="btn-glow-label">Go to App</span>
          </Link>
        </motion.div>
      </div>
    </section>
  );
});
ClosingSection.displayName = "ClosingSection";

// One full-screen slide per use case — icon/text still slide in from opposite sides and fade via
// the same scroll-linked dwell-zone curve as before (not useSectionReveal above: this one also
// needs opposite left/right x-offsets per column, which the shared hook doesn't produce), but the
// row itself is now the whole 100vh section rather than a compact block in a long page. `showIntro`
// renders the old "What you can build with Velum" header inline on the first slide only, so it
// still appears once without needing its own dedicated full-screen section.
//
// align-items-center (was align-items-start, top-aligning icon and text so the title started on
// the same line as the icon) — that made sense when the icon was a single ~48px glyph close in
// height to the text block next to it, but the collage (UseCaseCollage) is now several hundred
// pixels tall, so top-aligning left the text looking stranded near the top instead of centered
// against it. col-md-5 (was col-md-4) on the icon column only, giving the now-larger collage more
// room before .usecase-collage's own `min(…, 100%)` cap (theme-dark-glass.css) has to shrink it.
const UseCaseRow = React.forwardRef(({ icons, role, title, description, iconLeft, showIntro, scrollerRef }, ref) => {
  // `container: scrollerRef` — see the comment on useSectionReveal above for why this can't be
  // omitted (defaults to tracking window scroll, which never moves in this layout).
  const { scrollYProgress: rawProgress } = useScroll({
    target: ref,
    container: scrollerRef,
    offset: ["start end", "end start"],
  });
  const scrollYProgress = useSpring(rawProgress, REVEAL_SPRING);

  // Both position and opacity now hold flat through a small dwell zone around center
  // (0.42–0.58) instead of hitting their target at the single instant progress=0.5 and
  // immediately reversing — the row arrives a little before dead-center and doesn't start
  // leaving until a little after, so it actually sits still in "reading position" for a beat
  // instead of just passing through it.
  const iconX = useTransform(
    scrollYProgress,
    [0, 0.4, 0.6, 1],
    iconLeft ? [-260, 0, 0, -260] : [260, 0, 0, 260]
  );
  const textX = useTransform(
    scrollYProgress,
    [0, 0.4, 0.6, 1],
    iconLeft ? [260, 0, 0, 260] : [-260, 0, 0, -260]
  );
  // Flat 0 while genuinely far (0 to 0.3, and 0.7 to 1) instead of a straight-line ramp across
  // the whole [0, 1] span — a linear ramp meant the row was already partly visible (e.g. ~20%
  // opacity) well before it was anywhere near center, which read as "still visible while far
  // away". Ramps fully in/out across the same 0.3–0.42 / 0.58–0.7 windows the position above
  // uses, so fade and slide finish together, then holds at full opacity through the same
  // 0.42–0.58 dwell zone.
  const opacity = useTransform(scrollYProgress, REVEAL_OPACITY_STOPS, [0, 0, 1, 1, 0, 0]);

  return (
    <section ref={ref} className="landing-snap-section usecase-section">
      <div className="container">
        {showIntro && (
          <motion.div
            className="index-section-header index-section-header-compact usecase-intro-header"
            style={{ opacity }}
          >
            <h4 className="mb-1">What you can do with Velum</h4>
          </motion.div>
        )}
        <div className={`row align-items-center justify-content-center usecase-row role-${role}`}>
          <motion.div
            className="col-md-5 usecase-icon-col"
            style={{ order: iconLeft ? 1 : 2, x: iconX, opacity }}
          >
            <UseCaseCollage icons={icons} role={role} scrollYProgress={scrollYProgress} iconLeft={iconLeft} />
          </motion.div>
          <motion.div
            className="col-md-4 usecase-text-col"
            style={{ order: iconLeft ? 2 : 1, x: textX, opacity }}
          >
            <div className="usecase-text-inner" style={{ textAlign: iconLeft ? "left" : "right" }}>
              <h3 className="usecase-title">{title}</h3>
              <p className="text-muted usecase-desc">{description}</p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
});
UseCaseRow.displayName = "UseCaseRow";

// Fixed right-edge dot rail (theme-dark-glass.css's .landing-dot-nav) — one dot per full-screen
// section, active dot tracked by the IntersectionObserver in Dashboard below, click jumps via
// Dashboard's own goToSection (a custom-duration animated scroll, not native scrollIntoView — see
// animateScrollTo below for why).
const LandingDotNav = ({ activeIndex, onSelect }) => (
  <nav className="landing-dot-nav" aria-label="Section navigation">
    {SECTION_LABELS.map((label, i) => (
      <button
        key={label}
        type="button"
        className={`landing-dot${i === activeIndex ? " active" : ""}`}
        aria-label={label}
        aria-current={i === activeIndex}
        onClick={() => onSelect(i)}
      />
    ))}
  </nav>
);

// Slower than the browser's own default smooth-scroll pace, per explicit ask — CSS
// `scroll-behavior: smooth` (still set on .landing-snap-scroller) has no duration knob, so getting
// a specific, consistent pace means animating `scrollTop` by hand instead.
const SECTION_SCROLL_DURATION = 1300;
// After a section change lands, wheel events are ignored for this long: a trackpad keeps firing
// inertia events well after the gesture ends, which otherwise kicked off a second jump right away.
const WHEEL_COOLDOWN_MS = 450;

// Sine is gentler than the old cubic at both ends and through the middle — less of a lurch.
function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function animateScrollTo(scroller, targetTop, duration) {
  const startTop = scroller.scrollTop;
  const delta = targetTop - startTop;
  if (Math.abs(delta) < 1) return Promise.resolve();

  // The scroller's CSS snap (mandatory) and scroll-behavior:smooth both act on every scrollTop
  // write, fighting this frame-by-frame animation and making it stutter — both are switched off
  // for its duration and restored once it lands exactly on the section.
  const { scrollSnapType, scrollBehavior } = scroller.style;
  scroller.style.scrollSnapType = "none";
  scroller.style.scrollBehavior = "auto";

  return new Promise((resolve) => {
    const startTime = performance.now();
    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      scroller.scrollTop = startTop + delta * easeInOutSine(t);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        scroller.style.scrollSnapType = scrollSnapType;
        scroller.style.scrollBehavior = scrollBehavior;
        resolve();
      }
    }
    requestAnimationFrame(step);
  });
}

const Dashboard = () => {
  const scrollerRef = useRef(null);
  // One ref per SECTION_LABELS entry (hero + role + one per use case), created once — stable
  // identity across renders is what lets the IntersectionObserver effect below depend on it
  // safely without re-subscribing every render.
  const sectionRefs = useMemo(() => Array.from({ length: SECTION_LABELS.length }, () => React.createRef()), []);
  const [activeIndex, setActiveIndex] = useState(0);
  // Mirrors `activeIndex` for the wheel handler below, which is set up once (empty effect deps —
  // re-attaching a wheel listener on every activeIndex change would work but is unnecessary
  // churn) and so can't read the `activeIndex` state variable itself without closing over a stale
  // value. `isAnimatingRef` debounces rapid wheel events into a single section change per
  // animation — without it, one continuous trackpad gesture (which fires many small `wheel`
  // events, not one) would fire many section changes instead of exactly one.
  const activeIndexRef = useRef(0);
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // Drives the dot nav's active state from actual scroll position (which section is currently
  // filling most of the scroller's viewport) rather than from click state — so it stays correct
  // whether the user clicked a dot, scrolled/swiped, or used the keyboard.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const idx = sectionRefs.findIndex((r) => r.current === entry.target);
          if (idx !== -1) setActiveIndex(idx);
        });
      },
      { root: scroller, threshold: 0.5 }
    );

    sectionRefs.forEach((r) => {
      if (r.current) observer.observe(r.current);
    });

    return () => observer.disconnect();
  }, [sectionRefs]);

  // Animates to a section by index over SECTION_SCROLL_DURATION (see animateScrollTo above) —
  // used by both the dot nav (click) and the wheel handler below (scroll), so the two navigation
  // paths feel consistent. Ignored while another animation is already running.
  const goToSection = (index) => {
    const clamped = Math.max(0, Math.min(SECTION_LABELS.length - 1, index));
    const scroller = scrollerRef.current;
    const target = sectionRefs[clamped]?.current;
    if (!scroller || !target || isAnimatingRef.current) return;

    isAnimatingRef.current = true;
    activeIndexRef.current = clamped;
    setActiveIndex(clamped);

    const targetTop =
      target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    animateScrollTo(scroller, targetTop, SECTION_SCROLL_DURATION).then(() => {
      setTimeout(() => {
        isAnimatingRef.current = false;
      }, WHEEL_COOLDOWN_MS);
    });
  };

  // Wheel/trackpad navigation, hijacked from native scrolling entirely (`preventDefault` on every
  // event) so its pace can be the same custom-duration animation as the dot nav — CSS
  // `scroll-behavior: smooth` (still set on .landing-snap-scroller as a touch/swipe fallback, see
  // below) has no duration control, browsers just pick their own short default. One wheel "tick"
  // (or the whole burst of small deltaY events a single physical trackpad gesture fires) advances
  // exactly one section: `isAnimatingRef`'s lock swallows every event after the first until the
  // current animation finishes. Touch swipes on mobile are NOT intercepted here — they still use
  // the native (faster) CSS scroll-snap in theme-dark-glass.css, since a touch equivalent of this
  // would need its own touchstart/touchmove/touchend handling.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    const handleWheel = (event) => {
      event.preventDefault();
      if (isAnimatingRef.current) return;
      goToSection(activeIndexRef.current + (event.deltaY > 0 ? 1 : -1));
    };

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRefs]);

  return (
    <div className="landing-page">
      <LandingNav />
      <LandingDotNav activeIndex={activeIndex} onSelect={goToSection} />

      {/* Fixed to the bottom from the second screen on (the hero stays clean). AdaSouls is the
          company behind Velum. */}
      <footer className={`landing-fixed-footer${activeIndex > 0 ? " is-visible" : ""}`} aria-hidden={activeIndex === 0}>
        <div className="container landing-fixed-footer-content">
          <p className="text-muted small mb-0">© 2026 Velum. Built on Midnight.</p>
          <p className="landing-powered-by mb-0">
            <span>Powered by</span>
            <a
              href="https://adasouls.io"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AdaSouls (opens adasouls.io)"
              tabIndex={activeIndex === 0 ? -1 : undefined}
            >
              <img src={adasoulsLogo} alt="AdaSouls" width="104" height="32" />
            </a>
          </p>
        </div>
      </footer>

      {/* Reuses Layout's own .content-body wrapper directly rather than rendering <Layout>, since
          Layout unconditionally also renders the app's <Header/> with no way to opt out — but
          adds landing-scroll-body alongside it (theme-dark-glass.css) to cancel out
          .content-body's own padding-top:68px specifically here: with the header now
          transparent (per explicit feedback), sections need to render their full height BEHIND
          it, not be pushed down to start below it, or a transparent header still just shows the
          same flat page background through it — nothing actually visible passing underneath.
          organizerInfo.jsx/subscriberInfo.jsx (the other two pages sharing .landing-page) keep the
          normal .content-body clearance untouched; this is scoped to index.jsx only via that
          second class. .landing-snap-scroller (not .container — that's nested inside each section
          instead) is the actual scroll-snap viewport: each child section is exactly one screen
          tall and scroll-snap-align: start, so this is what makes the page advance one full
          section at a time instead of scrolling continuously. */}
      <div className="content-body landing-scroll-body">
        <div className="landing-snap-scroller" ref={scrollerRef}>
          <HeroSection ref={sectionRefs[0]} scrollerRef={scrollerRef} />
          <HowItWorksSection ref={sectionRefs[1]} scrollerRef={scrollerRef} />

          {USE_CASES.map((useCase, i) => (
            <UseCaseRow
              key={useCase.title}
              ref={sectionRefs[FIRST_USE_CASE_INDEX + i]}
              {...useCase}
              iconLeft={i % 2 === 0}
              showIntro={i === 0}
              scrollerRef={scrollerRef}
            />
          ))}

          <PrivacySection ref={sectionRefs[AFTER_USE_CASES_INDEX]} scrollerRef={scrollerRef} />
          <ReceivedSection ref={sectionRefs[AFTER_USE_CASES_INDEX + 1]} scrollerRef={scrollerRef} />
          <ClosingSection ref={sectionRefs[AFTER_USE_CASES_INDEX + 2]} scrollerRef={scrollerRef} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
