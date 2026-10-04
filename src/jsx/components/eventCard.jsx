import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import Chart from "react-apexcharts";
import { Award, BadgeCheck, Calendar, Database, ImageOff, Info, Link2, Lock, ShieldCheck, Ticket, X } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../contexts/drawer/drawer.provider";
import { useUserRoles } from "../contexts/user-roles/user-roles.provider";
import eventOwnerIcon from "../../icons/svg/collection-owner.svg";
import formatDateToDDMMYYYY from "../../utils/formatDateToDDMMYYYY";
import { getEventStatus, getEventStatusLabel } from "../../utils/poapHelpers";
import { getEvent, getTokensByEvent } from "../../midnight/indexer.service";
import { TOKEN_BURNED_EVENT } from "../../midnight/token-events";
import { inviteLink } from "../../midnight/invite-links";
import { useEventMetadata } from "../hooks/useEventMetadata";
import { findOwnershipRequest, publishOwnershipRequest } from "../../midnight/ownership-proof";
import { errorFunction, loadingFunction, succesfullBlockchainCreation } from "../toasts/sweetAlerts";
import CategoryBadge from "./CategoryBadge";
import { explorerBlockUrl, explorerContractUrl, explorerTxUrl } from "../../utils/midnightExplorer";
import { getClaimActionLabel, getSubscriberListLabel, getTaxonomyEntries } from "../constants/eventCategories";
import { friendlyErrorMessage } from "../../midnight/friendly-error";
import OrganizerLabel from "./OrganizerLabel";

const truncateHex = (hex) => {
  if (!hex) return "N/A";
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
};

// This card renders both the collapsed grid tile and the expanded detail view — same component
// instance either way (parent keeps it mounted, keyed by eventId, across expand/collapse), so
// framer-motion's `layout` prop FLIP-animates the resize in place, exactly like poapCard.jsx (see
// that file's own comment for the forwardRef/AnimatePresence-popLayout rationale — identical here).
// This used to be a separate floating position:fixed overlay, handed off from a "ghost" placeholder
// left in the grid via a shared layoutId between two mounted instances. That kept every other
// (still individually blurred-glass) card in the grid visible and painted throughout the whole
// resize animation, which was the main source of jank — switching to in-place expansion, plus the
// calling pages (myEvents.jsx/exploreEvents.jsx/mySubscriptions.jsx) now omitting non-expanded
// siblings from the grid entirely while one card is open, fixes both that and the expanded card's
// width no longer matching the grid (it's col-12 now, same as poapCard.jsx's own expanded width).
const EventCard = forwardRef(({
  event,
  isExpanded = false,
  onExpand = () => {},
  onCollapse = () => {},
  variant = "manage",
  onClaim = () => {},
  isSubscribed = false,
  subscriptionLoading = false,
  issuerBlocked = false,
  issuerVerified = false,
}, ref) => {
  const status = getEventStatus(event);
  const { metadata, loading: metadataLoading } = useEventMetadata(event.metadataURI);
  const claimLabel = getClaimActionLabel(metadata);
  // A subscriber who already holds this event's POAP sees that fact instead of the plain
  // active/full/etc. status — "Followed"/"Attended"/"Subscribed" (whichever verb this event's
  // category uses, see getClaimActionLabel) reads as "you're done here", which the event's own
  // active/full state doesn't communicate on its own. isSubscribed comes from the calling page
  // (exploreEvents.jsx), computed once for the whole list rather than per-card.
  const alreadyHeld = variant === "explore" && isSubscribed;
  // issuerBlocked (useBlockedIssuers): the admin blocked this event's organizer, so the contract
  // rejects every new claim/mint under it even though the event itself is still active on-chain.
  // Explore Events hides these entirely; My Events keeps them, labeled, so the organizer can see why.
  const statusLabel = issuerBlocked
    ? "Organizer blocked"
    : alreadyHeld
    ? claimLabel.done
    : getEventStatusLabel(status, variant === "explore" ? "subscriber" : "organizer");
  const taxonomyEntries = useMemo(
    () => getTaxonomyEntries(metadata?.category, metadata),
    [metadata],
  );
  // Tracks a failed <img> load (bad/expired gateway URL etc.) separately from "still fetching" —
  // both render the same broken-image icon instead of ever falling back to a stale previously-
  // loaded image or the old generic placeholder icon, per explicit request: no old/wrong image,
  // ever, while the real one isn't confirmed available.
  const [imgLoadError, setImgLoadError] = useState(false);
  useEffect(() => {
    setImgLoadError(false);
  }, [metadata?.imageUrl]);
  // Split from metadataLoading on purpose — a still-loading card shows the pulsing skeleton
  // (.skeleton-block below), not this broken-image icon, so a slow IPFS fetch doesn't read as
  // "something failed." showBrokenImage is only the genuine no-image/failed-load case, once
  // loading has actually finished one way or the other.
  const showBrokenImage = !metadataLoading && (!metadata?.imageUrl || imgLoadError);
  const { midnight: { provider } } = useDrawer();
  const { isAdmin } = useUserRoles();
  const dispatch = useDrawerDispatch();
  // Force-hidden under variant="explore" even though it's already naturally excluded there today
  // (Explore Events never lists the viewer's own events) — defense-in-depth against a future
  // change that renders this variant for an event the viewer does organize.
  // Ownership (not the separate isIssuer "verified organizer" badge) is what actually gates
  // minting on-chain — event creation is permissionless now, matching the contract's own mintTo
  // authorization (is_admin() || ev.organizer == caller_pk()).
  // !event.isPublicMint is a frontend-only restriction on top of that: the contract itself doesn't
  // forbid push-minting into a public event, but public events are meant to be self-claimed via
  // claim() (see createPoap.jsx/"Subscribe") — push-minting into one would silently bypass
  // that flow, so the organizer-mint UI only offers this for the organizer's own private
  // (organizer-minted) events.
  const canMintForEvent =
    variant !== "explore" &&
    !event.isPublicMint &&
    !issuerBlocked &&
    (isAdmin || provider?.address === event.issuerPk);

  const openMintDrawer = () => {
    dispatch({ type: "CREATE_MINT", payload: event });
  };

  // Invite link (invite-links.ts): whoever opens it gets their key for this organizer generated and
  // sends back a mint link that opens Mint POAP pre-filled — no keys to paste either way.
  const openInviteLink = () => {
    dispatch({
      type: "SHOW_LINK_QR",
      payload: {
        title: "Invite Link",
        intro: "Send this to the person who should receive a credential, or let them scan it. It generates their key for you and gives them a link back that opens Mint POAP with everything filled in.",
        url: inviteLink(window.location.origin, event.issuerPk, event.eventId),
        label: metadata?.name || null,
      },
    });
  };

  const subscriberListLabel = getSubscriberListLabel(metadata);
  const openSubscribersDrawer = () => {
    dispatch({
      type: "SHOW_SUBSCRIBERS",
      payload: { event, tokens: eventTokens, label: subscriberListLabel, eventName: metadata?.name || null },
    });
  };

  // Raw blockchain data lives behind this popup now, not inline — see BlockchainInfoModal.jsx.
  // deactivatedBlock only exists once the event's been deactivated, contractAddress is the same
  // constant for every event/token so it's added here rather than being part of any event.* data.
  // Block/Tx/Contract rows deep-link into midnightexplorer.com. Event ID and Organizer are values
  // inside this contract's own ledger state, not chain-level objects, so the explorer has no page
  // for them — they stay plain text.
  // The organizer-key copy badge only matters for Credentials: those are push-minted (mintTo), so
  // the organizer has to hand this key to the recipient for them to generate their per-issuer key
  // (Get My Key). Subscribers (variant="explore") and self-claimed event types never need it.
  const showOrganizerKeyBadge = variant === "manage" && metadata?.category === "credential";
  const openBlockchainInfoDrawer = () => {
    const contractAddress = process.env.REACT_APP_MIDNIGHT_CONTRACT_ADDRESS;
    const fields = [
      { key: "eventId", label: "Event ID", value: event.eventId },
      showOrganizerKeyBadge
        ? {
            key: "organizer",
            label: "Organizer",
            value: event.issuerPk,
            copyable: true,
            copyAriaLabel: "Copy organizer key",
            hint: "Share this with the credential recipient so they can generate their own key for you (My Subscriptions → Paste Link).",
          }
        : { key: "organizer", label: "Organizer", value: event.issuerPk },
      { key: "block", label: "Block", value: event.createdBlock ?? "N/A", href: explorerBlockUrl(event.createdBlock) },
      { key: "tx", label: "Tx", value: event.createdTx, href: explorerTxUrl(event.createdTx) },
    ];
    if (!event.isActive && event.deactivatedBlock) {
      fields.push({
        key: "deactivatedBlock",
        label: "Deactivated At Block",
        value: event.deactivatedBlock,
        href: explorerBlockUrl(event.deactivatedBlock),
      });
    }
    fields.push({
      key: "contractAddress",
      label: "Contract Address",
      value: contractAddress,
      href: explorerContractUrl(contractAddress),
      copyable: true,
    });
    dispatch({ type: "SHOW_BLOCKCHAIN_INFO", payload: { title: "Blockchain Info", fields } });
  };

  // Open to any connected wallet, not just this event's own organizer — poap.compact's
  // publishDisclosureRequest has no organizer/admin gate (see docs/selective-disclosure-ui-design.md).
  // Only Credential events with private fields (createEvent.jsx → credentialAttributeFields) show
  // it: the one holder the request is addressed to answers from their POAP (holderProofs.jsx),
  // without revealing the value. Event-level private
  // attributes were removed 2026-09-24 (same value for every holder, so a question about them said
  // nothing about the person).
  const privateAttributeFields = metadata?.credentialAttributeFields || [];
  const openPublishDisclosureRequestDrawer = () => {
    dispatch({
      type: "PUBLISH_DISCLOSURE_REQUEST",
      payload: { eventId: event.eventId, fields: privateAttributeFields },
    });
  };

  // "Ask for Proof of Ownership" — the organizer publishes a plain request for this event once, so
  // holders can run "Prove Ownership" (poapCard.jsx) with one signature and without
  // publishing a request from their own caller_pk (see src/midnight/ownership-proof.ts). Costs the
  // organizer nothing privacy-wise: their pk is already public as this event's organizer.
  // null = still checking, true/false once the indexer answered.
  const isOwnEvent = variant === "manage" && Boolean(provider?.address) && provider.address === event.issuerPk;
  const [ownershipRequestPublished, setOwnershipRequestPublished] = useState(null);
  const [publishingOwnershipRequest, setPublishingOwnershipRequest] = useState(false);

  useEffect(() => {
    if (!isExpanded || !isOwnEvent) return undefined;
    let cancelled = false;
    findOwnershipRequest({ eventIdHex: event.eventId, organizerPkHex: event.issuerPk, myPkHex: provider.address })
      .then((choice) => {
        if (!cancelled) setOwnershipRequestPublished(choice.source === "organizer");
      })
      .catch((error) => {
        console.error("Error loading ownership requests:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, isOwnEvent, event.eventId, event.issuerPk, provider?.address]);

  const askForProofOfOwnership = async () => {
    if (!provider?.service) return;
    setPublishingOwnershipRequest(true);
    try {
      loadingFunction("Asking for Proof of Ownership", "Preparing transaction…", "");
      const { txHash } = await publishOwnershipRequest(provider.service, event.eventId);
      setOwnershipRequestPublished(true);
      succesfullBlockchainCreation(
        "Proof of Ownership Enabled",
        `Holders of this POAP can now prove they own it with one signature.${txHash ? ` Transaction: ${txHash}` : ""}`,
        "",
      );
    } catch (error) {
      console.error("Error publishing ownership request:", error);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to publish the request. Please try again."), "");
    } finally {
      setPublishingOwnershipRequest(false);
    }
  };

  const statusBadgeClass = issuerBlocked
    ? "badge bg-danger"
    : alreadyHeld
    ? "badge status-badge-held"
    : {
        active: "badge status-badge-active",
        expired: "badge bg-danger",
        full: "badge bg-warning",
        inactive: "badge bg-secondary",
      }[status];

  const available = event.maxSupply > 0 ? Math.max(0, event.maxSupply - event.minted) : undefined;

  // Collapsed tile's footer: minted/available on the left, the category badge pinned bottom-right.
  // Actions (Subscribe/Mint POAP) live only in the expanded card — the collapsed tile is
  // click-to-expand, not a place to act from, so this slot shows the category badge. The text may
  // wrap inside its own box, never pushing the badge onto a line of its own.
  const renderFooterRow = (placement) => (
    <div className={`card-event-footer-row ${placement}`} style={textStyle}>
      <small className="text-muted card-event-footer-minted" style={{ fontSize: "11px" }}>
        Minted: <strong className="text-white">{event.minted}/{event.maxSupply || "∞"}</strong>
        {available !== undefined && (
          <span className="ml-2">(Available: <strong className="text-white">{available}</strong>)</span>
        )}
      </small>
      <CategoryBadge category={metadata?.category} />
    </div>
  );
  const progressPercentage = event.maxSupply > 0 ? Math.min((event.minted / event.maxSupply) * 100, 100) : 0;

  // Fetched only while expanded — getAllEvents() (the page's own poll, event.* here) doesn't
  // include liveTokens, only GET /api/events/:id does, and the collapsed tile never shows this
  // content so has no reason to fetch it too. Refetched whenever the page's poll brings a new
  // event.minted (e.g. right after a mintTo from this card) — only the first fetch shows "…", so
  // later refreshes swap the number in place instead of flickering.
  const [eventDetail, setEventDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailLoadedForRef = useRef(null);

  useEffect(() => {
    if (!isExpanded) return undefined;
    let cancelled = false;
    if (detailLoadedForRef.current !== event.eventId) setDetailLoading(true);
    getEvent(event.eventId)
      .then((detail) => {
        if (cancelled) return;
        setEventDetail(detail);
        detailLoadedForRef.current = event.eventId;
      })
      .catch((error) => {
        console.error("Error loading event detail:", error);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, event.eventId, event.minted]);

  // Token breakdown donut for the organizer's own view (variant !== "explore") — what "counts" as
  // a segment depends on the event: unlimited-supply events (maxSupply === 0) have no "Available"
  // slice, and an event nobody has burned from has no "Burned" slice, so segments are built up
  // conditionally and zero-value ones dropped, rather than always rendering a fixed 3-slice chart.
  // liveTokens (from GET /api/events/:id, non-burned first claims) vs. event.minted (all-time
  // first claims, burned or not) is what makes "Burned" derivable without its own indexer field.
  const liveTokens = eventDetail?.liveTokens;
  const burnedTokens = liveTokens !== undefined ? Math.max(0, event.minted - liveTokens) : undefined;
  const statsSegments = useMemo(() => {
    if (detailLoading || liveTokens === undefined) return [];
    const segments = [{ label: "Subscribed", value: liveTokens, color: "#34c38f" }];
    if (burnedTokens > 0) segments.push({ label: "Burned", value: burnedTokens, color: "#74788d" });
    if (event.maxSupply > 0) segments.push({ label: "Available", value: available ?? 0, color: "rgba(196,205,246,0.4)" });
    return segments.filter((segment) => segment.value > 0);
  }, [detailLoading, liveTokens, burnedTokens, event.maxSupply, available]);
  const statsChartOptions = {
    labels: statsSegments.map((segment) => segment.label),
    colors: statsSegments.map((segment) => segment.color),
    legend: { position: "bottom", labels: { colors: "#c4cdf6" } },
    dataLabels: { enabled: true },
    stroke: { colors: ["#10206e"] },
    chart: { foreColor: "#c4cdf6" },
    tooltip: { theme: "dark" },
  };
  const statsChartSeries = statsSegments.map((segment) => segment.value);

  // The by-event token list only covers each token's *first* claim (see indexer.service.ts /
  // GET /api/events/:id/tokens comment) — matches eventDetail.liveTokens (non-burned first
  // claims), not total attendance. Only rendered for variant="manage" (the icon grid) — a
  // subscriber viewing variant="explore" gets a single preview card instead (every self-claimed
  // token shares the event's own image anyway), so skip the fetch there entirely.
  const [eventTokens, setEventTokens] = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  // Organizer view only, once the event's tokens have loaded and there is at least one.
  const showRecipientsButton = variant !== "explore" && !tokensLoading && eventTokens.length > 0;

  useEffect(() => {
    if (!isExpanded || variant === "explore") return undefined;
    let cancelled = false;
    setTokensLoading(true);
    getTokensByEvent(event.eventId)
      .then((tokens) => {
        if (!cancelled) setEventTokens(tokens);
      })
      .catch((error) => {
        console.error("Error loading event tokens:", error);
      })
      .finally(() => {
        if (!cancelled) setTokensLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, variant, event.eventId]);

  // A Revoke from this event's subscribers list (burnToken.jsx) shows up right away: the token is
  // marked burned here and liveTokens drops by one. Neither comes back from the page's own poll
  // (a burn doesn't change event.minted), so both are refetched a bit later — and the local marks
  // are kept on top, in case the indexer hasn't caught up by then.
  const burnedHereRef = useRef(new Set());
  useEffect(() => {
    if (!isExpanded || variant === "explore") return undefined;
    let timer = null;
    const markBurned = (tokens) =>
      tokens.map((token) => (burnedHereRef.current.has(String(token.tokenId)) ? { ...token, isBurned: true } : token));
    const onBurned = ({ detail }) => {
      if (detail?.eventId !== event.eventId) return;
      burnedHereRef.current.add(detail.tokenId);
      setEventTokens(markBurned);
      setEventDetail((current) =>
        current && current.liveTokens > 0 ? { ...current, liveTokens: current.liveTokens - 1 } : current,
      );
      clearTimeout(timer);
      timer = setTimeout(() => {
        getTokensByEvent(event.eventId).then((tokens) => setEventTokens(markBurned(tokens))).catch(() => {});
        getEvent(event.eventId)
          .then((detail) =>
            setEventDetail((current) =>
              current && detail && detail.liveTokens > current.liveTokens ? current : detail,
            ),
          )
          .catch(() => {});
      }, 8000);
    };
    window.addEventListener(TOKEN_BURNED_EVENT, onBurned);
    return () => {
      window.removeEventListener(TOKEN_BURNED_EVENT, onBurned);
      clearTimeout(timer);
    };
  }, [isExpanded, variant, event.eventId]);

  // Text reflows (wrapping, line-count changes) as the card's width/height FLIP-animates, which
  // looks janky since framer-motion only interpolates the box, not text layout — same problem and
  // same fix as poapCard.jsx: fade the content out first, THEN trigger the actual expand/collapse
  // once the fade has finished (the resize starts only after that, via the delayed onExpand/
  // onCollapse below), and fade back in only once `onLayoutAnimationComplete` confirms the resize
  // itself is done.
  const TEXT_FADE_MS = 150;
  const [showText, setShowText] = useState(true);
  const textStyle = { opacity: showText ? 1 : 0, transition: `opacity ${TEXT_FADE_MS}ms ease` };
  const pendingActionRef = useRef(null);

  const handleExpand = () => {
    setShowText(false);
    pendingActionRef.current = setTimeout(() => {
      pendingActionRef.current = null;
      onExpand();
    }, TEXT_FADE_MS);
  };

  const handleCollapse = () => {
    setShowText(false);
    pendingActionRef.current = setTimeout(() => {
      pendingActionRef.current = null;
      onCollapse();
    }, TEXT_FADE_MS);
  };

  return (
    <motion.div
      ref={ref}
      layout
      className={isExpanded ? "col-12 mb-3" : "col-xxl-6 col-lg-6 col-md-12 mb-3"}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ layout: { duration: 0.3, ease: "easeInOut" }, duration: 0.2, ease: "easeInOut" }}
    >
      {/* .card-hover-group is a plain, padding-free wrapper — see poapCard.jsx's identical
          comment for why position:relative can't just live on the outer Bootstrap column
          (its own gutter padding made the peek wider than the card). Static sibling, not a
          child of the card that moves. */}
      <div className="card-hover-group">
        {!isExpanded && <div className="card-hover-peek" />}
        <motion.div
          layout
          className={`card card-event card-classic card-outline-only${isExpanded ? " card-detail-expanded" : ""}`}
          style={{
            cursor: isExpanded ? "default" : "pointer",
            borderRadius: 16,
            border: "none",
            boxShadow: "inset 0 0 0 1px var(--glass-border)",
            position: "relative",
            zIndex: 1,
          }}
          whileHover={!isExpanded ? { y: -2 } : undefined}
          whileTap={!isExpanded ? { scale: 0.99 } : undefined}
          transition={{ layout: { duration: 0.3, ease: "easeInOut" }, duration: 0.2, ease: "easeInOut" }}
          onClick={!isExpanded ? handleExpand : undefined}
          onLayoutAnimationComplete={() => setShowText(true)}
        >
          <div className="card-body card-outline-only-body card-media-body">
            {/* The thumb — and its whole ancestor chain up to here — is rendered unconditionally
                below, never inside an `isExpanded ? A : B` branch. Only className/style toggle per
                state; the actual elements (including the motion.div thumb itself) stay mounted
                continuously across expand/collapse. That's what framer-motion's `layout` FLIP
                actually needs: a real before/after measurement of the SAME node. Two entirely
                different subtrees for collapsed vs. expanded (the previous shape of this branch)
                meant the thumb unmounted and a fresh one mounted in the other branch every time —
                a freshly mounted node has no "before" to interpolate from, so it just snapped
                straight to its final CSS position instead of animating there, and since the
                collapsed → expanded move is diagonal (both axes change at once), that snap looked
                like an L-shaped hop — one axis resolving via instant layout reflow, the other via
                the card's own resize — with the image effectively disappearing from view for a
                moment in between. */}
            <div className={isExpanded ? "row" : undefined}>
              {/* Expanded: both columns are flex columns stretched to the row's height, and each one's
                  bottom buttons sit in an mt-auto block, so the left and right button rows always
                  end on the same line, whichever column is taller. */}
              <div className={isExpanded ? "col-md-7 d-flex flex-column" : undefined}>
                <div className={isExpanded ? "d-flex align-items-start" : "d-flex align-items-stretch card-media-row"}>
                  {/* The image is never part of textStyle's fade — only text fades out before the
                      resize and back in after; the image stays visible throughout. */}
                  {/* Explicit layout transition, slightly slower than the card's own (0.3s) —
                      without this the thumb used framer-motion's default spring, which finished
                      before the card's own resize tween did, so the image briefly overshot the
                      card's still-mid-resize bounds and poked out past its edge. */}
                  <motion.div
                    layout
                    transition={{ layout: { duration: 0.45, ease: "easeInOut" } }}
                    className={isExpanded ? "card-media-thumb-wrap mr-3" : "card-media-thumb-wrap"}
                  >
                    {metadataLoading ? (
                      <div className="skeleton-block" style={{ width: "100%", height: "100%" }} />
                    ) : showBrokenImage ? (
                      <ImageOff size={22} className="card-media-thumb-broken-icon" />
                    ) : (
                      <img
                        className="card-media-thumb-photo"
                        src={metadata.imageUrl}
                        alt=""
                        onError={() => setImgLoadError(true)}
                      />
                    )}
                  </motion.div>

                  {!isExpanded ? (
                    <div className="card-media-content" style={textStyle}>
                      <div className="d-flex align-items-start justify-content-between mb-1">
                        {metadataLoading ? (
                          <div className="skeleton-block" style={{ height: "15px", width: "60%" }} />
                        ) : (
                          <h4 className="mb-0" style={{ fontSize: "15px", fontWeight: "600" }}>
                            {metadata?.name || `Event ${truncateHex(event.eventId)}`}
                          </h4>
                        )}
                        <span
                          className={`${statusBadgeClass} flex-shrink-0 ml-2`}
                          style={{ fontSize: "10px", padding: "2px 8px" }}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <ul
                        className="list-unstyled mb-2 mt-2 d-flex flex-column justify-content-center flex-grow-1"
                        style={{ fontSize: "12px" }}
                      >
                        <li className="d-flex align-items-center mb-1">
                          <img className="mr-2" src={eventOwnerIcon} width="14" height="14" alt="" style={{ flexShrink: 0 }} />
                          <span className="text-muted small">
                            Organizer: <OrganizerLabel name={metadata?.organization?.name} issuerPk={event.issuerPk} verified={issuerVerified} />
                          </span>
                        </li>
                        <li className="d-flex align-items-center mb-1">
                          <Calendar size={14} className="mr-2" style={{ flexShrink: 0, width: "14px" }} />
                          <span className="text-muted small">
                            {event.expiration > 0 ? formatDateToDDMMYYYY(new Date(event.expiration * 1000)) : "No expiry"}
                          </span>
                        </li>
                        <li className="d-flex align-items-center">
                          <Info size={14} className="mr-2" style={{ flexShrink: 0, width: "14px" }} />
                          <span className="text-muted small">{event.isPublicMint ? "Public mint" : "Organizer-minted"}</span>
                        </li>
                      </ul>

                      {renderFooterRow("card-event-footer-row-inline")}
                    </div>
                  ) : (
                    <div style={{ flex: 1, minWidth: 0, ...textStyle }}>
                      {/* Phones only (theme-dark-glass.css): type and status side by side in the
                          card's top-left corner, level with the collapse button. The desktop row
                          below is hidden there. */}
                      <div className="card-mobile-badge-row">
                        <CategoryBadge category={metadata?.category} />
                        <span className={`${statusBadgeClass} card-mobile-status-badge`}>{statusLabel}</span>
                      </div>
                      <div className="d-flex align-items-center justify-content-between card-detail-top-row">
                        <span
                          className={statusBadgeClass}
                          style={{ fontSize: "11px", padding: "3px 10px" }}
                        >
                          {statusLabel}
                        </span>
                        <CategoryBadge category={metadata?.category} />
                      </div>
                      {metadataLoading ? (
                        <div className="skeleton-block mt-2" style={{ height: "16px", width: "160px" }} />
                      ) : (
                        <h4 className="mt-2 mb-2" style={{ fontSize: "16px", fontWeight: "600" }}>
                          {metadata?.name || `Event ${truncateHex(event.eventId)}`}
                        </h4>
                      )}
                      {metadataLoading ? (
                        <div className="skeleton-block mt-2" style={{ height: "12px", width: "220px" }} />
                      ) : (
                        metadata?.description && (
                          <p className="text-muted small mb-0">{metadata.description}</p>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* Phones: the same footer row moves below the image, across the card's full
                    width (the inline one above is hidden there, see theme-dark-glass.css). */}
                {!isExpanded && renderFooterRow("card-event-footer-row-below")}

                {isExpanded && (
                  /* Quick facts (organizer/expiration/public-mint/minted-available) beside a
                     taxonomy breakdown column, then optional channels/organization block, then raw
                     blockchain detail. textStyle fades this whole block out before the resize and
                     back in after (TEXT_FADE_MS above), separately from the header row above. */
                  <div className="d-flex flex-column flex-grow-1" style={textStyle}>
                  <hr style={{ marginTop: "18px", marginBottom: "18px" }} />

                  <div className="row no-gutters">
                    <div className={taxonomyEntries.length > 0 ? "col-6" : "col-12"}>
                      <ul className="list-unstyled mb-0" style={{ fontSize: "12px" }}>
                        <li className="d-flex align-items-center mb-2">
                          <span className="quick-fact-icon">
                            <img src={eventOwnerIcon} width="14" height="14" alt="" />
                          </span>
                          <span className="text-muted small">
                            Organizer:{" "}<OrganizerLabel name={metadata?.organization?.name} issuerPk={event.issuerPk} verified={issuerVerified} />
                          </span>
                        </li>
                        <li className="d-flex align-items-center mb-2">
                          <span className="quick-fact-icon">
                            <Calendar size={14} />
                          </span>
                          <span className="text-muted small">
                            {event.expiration > 0 ? formatDateToDDMMYYYY(new Date(event.expiration * 1000)) : "No expiry"}
                          </span>
                        </li>
                        <li className="d-flex align-items-center mb-2">
                          <span className="quick-fact-icon">
                            <Info size={14} />
                          </span>
                          <span className="text-muted small">{event.isPublicMint ? "Public mint" : "Organizer-minted"}</span>
                        </li>
                        <li className="d-flex align-items-center">
                          <span className="quick-fact-icon">
                            <Ticket size={14} />
                          </span>
                          <span className="text-muted small">
                            Minted:{" "}<span className="text-white">{event.minted}/{event.maxSupply || "∞"}</span>
                            {available !== undefined && (
                              <> · Available:{" "}<span className="text-white">{available}</span></>
                            )}
                          </span>
                        </li>
                      </ul>
                    </div>

                    {/* Second column: the taxonomy answers collected at creation time (organizer
                        type, format, purpose, event/credential type — whichever fields this event's
                        category has, see eventCategories.js) — broken out individually rather than
                        left buried in the raw metadata JSON. Rows use the same d-flex/mb-2 rhythm as
                        the first column (even without an icon of their own) so each row's height
                        matches its counterpart across the two columns line for line. */}
                    {taxonomyEntries.length > 0 && (
                      <div className="col-6">
                        <ul className="list-unstyled mb-0" style={{ fontSize: "12px" }}>
                          {taxonomyEntries.map((entry) => (
                            <li className="d-flex align-items-center mb-2" key={entry.field}>
                              <span className="text-muted small">
                                {entry.label}: <span className="text-white">{entry.value}</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {(metadata?.channels?.length > 0 || metadata?.organization) && (
                    <>
                      <hr style={{ marginTop: "18px", marginBottom: "18px" }} />
                      <ul className="list-unstyled mb-0" style={{ fontSize: "12px" }}>
                        {metadata.channels?.map((channel, index) => (
                          <li className="mb-1" key={index}>
                            <span className="text-muted small text-capitalize">{channel.type}:{" "}</span>
                            <span className="text-white small">{channel.value}</span>
                          </li>
                        ))}
                        {metadata.organization && (
                          <li className="mt-1">
                            <span className="text-muted small">
                              {[
                                metadata.organization.addressLine,
                                metadata.organization.locality,
                                metadata.organization.region,
                                metadata.organization.country,
                                metadata.organization.postalCode,
                              ]
                                .filter(Boolean)
                                .join(", ")}
                            </span>
                          </li>
                        )}
                      </ul>
                    </>
                  )}

                  {issuerBlocked && (
                    <p className="text-muted small mt-3 mb-0">
                      An admin has blocked this organizer. Nobody can claim or be minted this event's
                      POAP anymore, and credentials already issued stay with their holders.
                    </p>
                  )}

                  {!event.isActive && event.deactivatedBlock && (
                    <p className="text-muted small mt-3 mb-0">
                      Deactivated at block <span className="text-white">{event.deactivatedBlock}</span>.
                    </p>
                  )}

                  <div className="mt-auto">
                  <hr style={{ marginTop: "18px", marginBottom: "18px" }} />

                  <div className="d-flex flex-wrap" style={{ gap: "8px" }}>
                  <button
                    type="button"
                    className="btn btn-card-detail-action btn-sm"
                    onClick={openBlockchainInfoDrawer}
                  >
                    <Database size={14} className="mr-2" />
                    View Blockchain Info
                  </button>

                  {isOwnEvent &&
                    (ownershipRequestPublished ? (
                      <span
                        className="btn btn-card-detail-action btn-sm disabled"
                        title="Holders can prove they hold this POAP (by token, or anonymously) with one signature."
                      >
                        <BadgeCheck size={14} className="mr-2" />
                        Proof of Ownership Enabled
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-card-detail-action btn-sm"
                        onClick={askForProofOfOwnership}
                        disabled={ownershipRequestPublished === null || publishingOwnershipRequest}
                        title="Publish a request so holders can prove they hold this POAP — by token, or anonymously — with one signature."
                      >
                        <ShieldCheck size={14} className="mr-2" />
                        Ask for Proof of Ownership
                      </button>
                    ))}

                  {privateAttributeFields.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-card-detail-action btn-sm"
                      onClick={openPublishDisclosureRequestDrawer}
                    >
                      <Lock size={14} className="mr-2" />
                      Ask for a Disclosure
                    </button>
                  )}
                  </div>
                  </div>
                  </div>
                )}
              </div>

              {isExpanded && (
                <div
                  className="col-md-5 d-flex flex-column card-detail-side-col"
                  style={textStyle}
                >
                  <div className="d-flex align-items-center justify-content-end mb-3">
                    <button
                      type="button"
                      className="card-expand-close-btn card-expand-close-btn-inline"
                      onClick={handleCollapse}
                      aria-label="Collapse event details"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {variant === "explore" ? (
                    <>
                      {/* Every self-claimed token inherits the event's own image, so there's no point
                          showing a grid of identical icons here — a subscriber cares about "what will
                          I get", not "how many are there". One preview card answers that, and doubles
                          as the already-held indicator (isSubscribed, from the calling page). */}
                      <PoapPreviewCard
                        loading={metadataLoading}
                        broken={showBrokenImage}
                        imageUrl={metadata?.poapImageUrl || metadata?.imageUrl}
                        title={isSubscribed ? claimLabel.done : metadata?.name || "This event's POAP"}
                        subtitle={
                          isSubscribed
                            ? "You already hold this POAP."
                            : `This is the POAP you'll receive if you ${claimLabel.action.toLowerCase()}.`
                        }
                      />

                      <div className="d-flex justify-content-end mt-3">
                        <span className="badge badge-count-outline">
                          {detailLoading ? "…" : eventDetail?.liveTokens ?? 0} minted
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* The organizer gets the same "what a subscriber receives" preview the
                          subscriber-facing view shows, plus a breakdown chart — the icon grid below
                          answers "how many/which tokens", this answers "what does it look like" and
                          "what's the current split". */}
                      <PoapPreviewCard
                        loading={metadataLoading}
                        broken={showBrokenImage}
                        imageUrl={metadata?.poapImageUrl || metadata?.imageUrl}
                        title={metadata?.name || "This event's POAP"}
                        subtitle="What subscribers receive by claiming this event."
                      />

                      <div className="d-flex justify-content-end mt-3">
                        <span className="badge badge-count-outline">
                          {detailLoading ? "…" : eventDetail?.liveTokens ?? 0} minted
                        </span>
                      </div>

                      {/* Gated on showText (not just statsSegments), unlike everything else in
                          this column — ApexCharts' initial SVG render is heavy enough that
                          mounting it the instant isExpanded flips true (same frame the thumb's
                          layout animation starts) competed with that animation for the browser's
                          frame budget and made the thumb's move look rushed/choppier specifically
                          on this variant="manage" page (myEvents.jsx), the only one with this
                          chart at all. Deferring its mount until after the resize+fade sequence
                          finishes (showText flips true in onLayoutAnimationComplete, same as the
                          rest of the fade-back-in) keeps that work off the animation's critical
                          path instead of just re-tuning the duration further. */}
                      {showText && statsSegments.length > 0 && (
                        <div className="mt-3">
                          <p className="small text-muted mb-2">Token breakdown</p>
                          <Chart options={statsChartOptions} series={statsChartSeries} type="donut" height={180} />
                        </div>
                      )}
                    </>
                  )}

                  {/* Bottom row, on the same line as the left column's buttons: the recipients list
                      on the left, the actions on the right (Invite Link, then Mint POAP). */}
                  {(showRecipientsButton || canMintForEvent || variant === "explore") && (
                    <div className="card-detail-actions card-detail-actions-inline mt-auto pt-3">
                      {showRecipientsButton && (
                        <button
                          type="button"
                          className="btn btn-card-detail-action btn-sm"
                          onClick={openSubscribersDrawer}
                        >
                          View {subscriberListLabel} ({eventTokens.length})
                        </button>
                      )}

                      <div className="d-flex flex-wrap justify-content-end ml-auto" style={{ gap: "8px" }}>
                      {canMintForEvent && (
                        <button
                          type="button"
                          className="btn btn-card-detail-action btn-sm"
                          onClick={openInviteLink}
                        >
                          <Link2 size={14} className="mr-2" />
                          Invite Link
                        </button>
                      )}

                      {canMintForEvent && (
                        <button
                          type="button"
                          className="btn btn-card-detail-action btn-card-detail-action-role btn-sm"
                          onClick={openMintDrawer}
                        >
                          Mint POAP
                        </button>
                      )}

                      {variant === "explore" && (
                        <button
                          type="button"
                          className="btn btn-card-detail-action btn-card-detail-action-role btn-sm"
                          onClick={() => onClaim(event)}
                          disabled={status !== "active" || isSubscribed || subscriptionLoading || issuerBlocked}
                        >
                          {isSubscribed ? claimLabel.done : claimLabel.action}
                        </button>
                      )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Minted bar — the one element that sits flush against the card's own bottom edge,
              outside card-body's padding, instead of just being "near the bottom" inside it. */}
          {event.maxSupply > 0 && (
            <div className="card-event-minted-bar">
              <div
                className="card-event-minted-bar-fill"
                role="progressbar"
                style={{ width: `${progressPercentage}%` }}
                aria-valuenow={progressPercentage}
                aria-valuemin="0"
                aria-valuemax="100"
              ></div>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
});

EventCard.displayName = "EventCard";

// The "what will/does a subscriber receive" preview shown in the expanded card's POAPs column —
// same markup for both variant="explore" (subscriber, with subscribed-state title/subtitle) and
// variant="manage" (organizer, with a static caption), so the two never visually drift apart.
function PoapPreviewCard({ loading, broken, imageUrl, title, subtitle }) {
  return (
    <div className="poap-preview-card">
      <div className="poap-preview-card-thumb">
        {loading ? (
          <div className="skeleton-block" style={{ width: "100%", height: "100%" }} />
        ) : broken ? (
          <Award size={20} className="card-media-thumb-broken-icon card-media-thumb-broken-icon-role" />
        ) : (
          <img className="card-media-thumb-photo" src={imageUrl} alt="" />
        )}
      </div>
      <div>
        <p className="m-0 small font-weight-semibold">{title}</p>
        {subtitle && <p className="m-0 text-muted small">{subtitle}</p>}
      </div>
    </div>
  );
}


export default EventCard;
