import { useEffect, useState } from "react";
import { X, Award, Flame, RefreshCw } from "lucide-react";
import {
  useDrawer,
  useDrawerDispatch,
} from "../../contexts/drawer/drawer.provider";
import { useUserRoles } from "../../contexts/user-roles/user-roles.provider";
import { getCredentialUpdateRequests } from "../../../midnight/indexer.service";

const truncateHex = (hex) => {
  if (!hex) return "N/A";
  return `${hex.slice(0, 10)}…${hex.slice(-8)}`;
};

// Read-only popup opened from eventCard.jsx's expanded organizer view — replaces the old icon grid
// (one thumbnail per claimer) with an actual list, since every self-claimed token shares the same
// image anyway so the icons never conveyed anything beyond a raw count. `subscribers` is stashed by
// the SHOW_SUBSCRIBERS dispatch (eventCard.jsx) as { event, tokens, label }, so this view does no
// fetching of its own — it just renders what the card already loaded.
//
// Fields shown are limited to what IndexedToken actually carries (indexer.service.ts): ownerPk,
// burned status, and mint block/tx as provenance. There's no claim timestamp and no flag
// distinguishing a self-claim from an organizer push-mint (mintTo) — both produce an identical
// token row today, so this list can't tell them apart either.
//
// The event's organizer (or the admin) gets a Revoke button on each live token: poap.compact's
// burn() accepts either, besides the owner. It opens burnToken.jsx's confirmation.
//
// Credential update requests (credential-update.ts): the organizer sees which holders asked for an
// update and reviews each one (reviewCredentialUpdate.jsx). Only the organizer: the request is
// sealed to their own inbox key. A token replaced by reissueCredential shows Re-issued instead of
// Burned (the new one names it in replacesTokenId).
export default function SubscribersList() {
  const { subscribers, midnight } = useDrawer();
  const dispatch = useDrawerDispatch();
  const { isAdmin } = useUserRoles();

  const closeDrawer = () => {
    dispatch({ type: "CLOSE_DRAWER" });
  };

  const tokens = subscribers?.tokens || [];
  const label = subscribers?.label || "Subscribers";
  const event = subscribers?.event;
  const myPk = midnight?.provider?.address;
  const canRevoke = Boolean(event && myPk) && (isAdmin || myPk === event.issuerPk);
  const isOrganizer = Boolean(event && myPk) && myPk === event.issuerPk;
  const replacedIds = new Set(tokens.map((token) => token.replacesTokenId).filter((id) => id != null).map(String));

  // tokenId → its pending update request, for this event.
  const [pendingUpdates, setPendingUpdates] = useState({});
  const issuerPk = event?.issuerPk;
  const eventId = event?.eventId;
  useEffect(() => {
    if (!isOrganizer) return undefined;
    let cancelled = false;
    getCredentialUpdateRequests({ issuerPk, status: "pending" })
      .then((requests) => {
        if (cancelled) return;
        const forEvent = requests.filter((request) => request.eventId === eventId);
        setPendingUpdates(Object.fromEntries(forEvent.map((request) => [String(request.tokenId), request])));
      })
      .catch((error) => console.error("Error loading update requests:", error));
    return () => {
      cancelled = true;
    };
  }, [isOrganizer, issuerPk, eventId]);

  const reviewContext = (token, extra) => ({
    event,
    token,
    eventName: subscribers?.eventName || null,
    credentialFields: subscribers?.credentialFields || [],
    ...extra,
  });
  const openReview = (token) => {
    dispatch({ type: "SHOW_REVIEW_UPDATE", payload: reviewContext(token, { request: pendingUpdates[String(token.tokenId)] }) });
  };

  const openRevoke = (token) => {
    dispatch({
      type: "SHOW_BURN_TOKEN",
      payload: { mode: "revoke", tokenId: token.tokenId, eventId: event.eventId, eventName: subscribers?.eventName || null },
    });
  };

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button
          className="btn wallet-modal-close"
          onClick={closeDrawer}
          aria-label="close"
        >
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">
          {label} ({tokens.length})
        </h4>
      </div>

      <div className="drawer-body">
        {tokens.length === 0 ? (
          <div className="alert alert-info" role="alert">
            No {label.toLowerCase()} yet.
          </div>
        ) : (
          <ul className="list-unstyled m-0 subscribers-list">
            {tokens.map((token) => (
              <li key={token.tokenId} className="subscribers-list-row">
                <Award size={16} className="card-media-thumb-broken-icon-role flex-shrink-0" />
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  <p className="m-0 text-break small font-weight-semibold">
                    {truncateHex(token.ownerPk)}
                  </p>
                  <p className="m-0 text-muted small">
                    Token #{token.tokenId}
                    {token.mintedBlock !== null && ` · Block ${token.mintedBlock}`}
                  </p>
                </div>
                <span className={`badge flex-shrink-0 ${token.isBurned ? "bg-secondary" : "status-badge-active"}`}>
                  {!token.isBurned ? "Active" : replacedIds.has(String(token.tokenId)) ? "Re-issued" : "Burned"}
                </span>
                {isOrganizer && !token.isBurned && pendingUpdates[String(token.tokenId)] && (
                  <button
                    type="button"
                    className="btn btn-card-detail-action btn-sm flex-shrink-0"
                    onClick={() => openReview(token)}
                    aria-label={`Review the update request for POAP #${token.tokenId}`}
                  >
                    <RefreshCw size={14} className="mr-1" />
                    Review Update
                  </button>
                )}
                {canRevoke && !token.isBurned && (
                  <button
                    type="button"
                    className="btn btn-card-detail-action btn-sm flex-shrink-0"
                    onClick={() => openRevoke(token)}
                    aria-label={`Revoke POAP #${token.tokenId}`}
                  >
                    <Flame size={14} className="mr-1" />
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
