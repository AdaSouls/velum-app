import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import Layout from "../layout/layout";
import { useDrawer, useDrawerDispatch } from "../contexts/drawer/drawer.provider";
import { fetchMetadata } from "../hooks/useEventMetadata";
import { getEvent } from "../../midnight/indexer.service";
import { parseRequestFragment } from "../../midnight/invite-links";
import loadingGif from "../../images/loading.gif";

const truncateHex = (hex) => `${hex.slice(0, 10)}…${hex.slice(-8)}`;

// A holder's request link (invite-links.ts → /app/request#event=…&to=<holder pk>), copied from Prove
// a Private Detail on their POAP. It's how someone other than the organizer (an employer, a venue…)
// asks about a private detail: Credential events are invite-only, so they never show up in Explore
// Events, and My Events only lists the wallet's own. Opens Ask for a Disclosure with the event and
// the holder filled in. publishDisclosureRequest has no organizer/admin gate, so any wallet may.
export default function RequestLink() {
  const { midnight } = useDrawer();
  const dispatch = useDrawerDispatch();
  const myPk = midnight?.provider?.address;
  // From the router, not window.location: Paste Link can open another link while this page is up.
  const { hash } = useLocation();
  const link = useMemo(() => parseRequestFragment(hash || ""), [hash]);
  // undefined = loading, null = not found
  const [found, setFound] = useState(undefined);
  const openedRef = useRef(false);

  useEffect(() => {
    openedRef.current = false;
    setFound(undefined);
    if (!link) return undefined;
    let cancelled = false;
    getEvent(link.eventIdHex)
      .then(async (event) => {
        if (!event) return null;
        const metadata = event.metadataURI ? await fetchMetadata(event.metadataURI) : null;
        return { event, metadata };
      })
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setFound(result);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  const fields = found?.metadata?.credentialAttributeFields || [];
  const ready = Boolean(link && myPk && found && fields.length > 0);

  const openRequest = useCallback(() => {
    dispatch({
      type: "PUBLISH_DISCLOSURE_REQUEST",
      payload: { eventId: found.event.eventId, fields, recipient: link.holderPkHex },
    });
  }, [dispatch, found, fields, link]);

  // Opens the popup by itself once, as soon as everything checks out.
  useEffect(() => {
    if (ready && !openedRef.current) {
      openedRef.current = true;
      openRequest();
    }
  }, [ready, openRequest]);

  const renderBody = () => {
    if (!link) {
      return (
        <div className="alert alert-danger" role="alert">
          This link isn't complete. Ask the person to copy it again from their POAP.
        </div>
      );
    }
    if (found === undefined) {
      return (
        <p className="text-muted small d-flex align-items-center">
          <img src={loadingGif} width="14" height="14" alt="" className="mr-2" />
          Loading the credential…
        </p>
      );
    }
    if (found === null) {
      return (
        <div className="alert alert-danger" role="alert">
          Could not find the event in this link.
        </div>
      );
    }
    if (fields.length === 0) {
      return (
        <div className="alert alert-info" role="alert">
          This credential has no private details to ask about.
        </div>
      );
    }
    const eventName = found.metadata?.name || truncateHex(found.event.eventId);
    if (!myPk) {
      return (
        <div className="alert alert-info" role="alert">
          Connect your wallet to ask the holder of <span className="text-white">{eventName}</span> about a
          private detail. Publishing the question takes one signature.
        </div>
      );
    }
    return (
      <div className="drawer-modal-preview-card">
        <p className="small mb-3">
          Asking the holder <span className="text-white">{truncateHex(link.holderPkHex)}</span> about their{" "}
          <span className="text-white">{eventName}</span> credential. They answer yes or no from their POAP,
          without revealing the value.
        </p>
        <button type="button" className="btn btn-card-detail-action btn-sm" onClick={openRequest}>
          Open Ask for a Disclosure
        </button>
      </div>
    );
  };

  return (
    <Layout>
      <div className="inner-header">
        <div className="inner-header-row">
          <h4 className="m-0">Ask for a Disclosure</h4>
        </div>
      </div>
      <div className="row">
        <div className="col-12 col-lg-8">{renderBody()}</div>
      </div>
    </Layout>
  );
}
