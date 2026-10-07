import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDrawer, useDrawerDispatch } from '../contexts/drawer/drawer.provider.jsx';
import LaceWallet from './views/laceWallet.jsx';
import CreatePoap from './views/createPoap.jsx';
import CreateEvent from './views/createEvent.jsx';
import CreateIssuer from './views/createIssuer.jsx';
import MintPoap from './views/mintPoap.jsx';
import GetHolderKey from './views/getHolderKey.jsx';
import SubscribersList from './views/subscribersList.jsx';
import BlockchainInfoModal from './views/blockchainInfoModal.jsx';
import PublishDisclosureRequest from './views/publishDisclosureRequest.jsx';
import BackupRestore from './views/backupRestore.jsx';
import ProveOwnership from './views/proveOwnership.jsx';
import HolderProofs from './views/holderProofs.jsx';
import BurnToken from './views/burnToken.jsx';
import LinkQrPopup from './views/linkQrPopup.jsx';
import ProofHistory from './views/proofHistory.jsx';
import OrganizerProfile from './views/organizerProfile.jsx';
import RequestCredentialUpdate from './views/requestCredentialUpdate.jsx';
import ReviewCredentialUpdate from './views/reviewCredentialUpdate.jsx';

export const Drawer = () => {

  const state = useDrawer();
  const dispatch = useDrawerDispatch();

  const drawerComponent = (state) => {

    if (state?.showMidnightWallet === true) {
      return <LaceWallet />;
    }

    if (state?.createPoap === true) {
      return <CreatePoap />;
    }

    if (state?.createEvent === true) {
      return <CreateEvent />;
    }

    if (state?.createIssuer === true) {
      return <CreateIssuer />;
    }

    if (state?.createMint === true) {
      return <MintPoap />;
    }

    if (state?.getHolderKey === true) {
      return <GetHolderKey />;
    }

    if (state?.showSubscribers === true) {
      return <SubscribersList />;
    }

    if (state?.showBlockchainInfo === true) {
      return <BlockchainInfoModal />;
    }

    if (state?.publishDisclosureRequest === true) {
      return <PublishDisclosureRequest />;
    }

    if (state?.showBackup === true) {
      return <BackupRestore />;
    }

    if (state?.proveOwnership === true) {
      return <ProveOwnership />;
    }

    if (state?.showHolderProofs === true) {
      return <HolderProofs />;
    }

    if (state?.burnToken === true) {
      return <BurnToken />;
    }

    if (state?.showLinkQr === true) {
      return <LinkQrPopup />;
    }

    if (state?.showProofHistory === true) {
      return <ProofHistory />;
    }

    if (state?.showOrganizerProfile === true) {
      return <OrganizerProfile />;
    }

    if (state?.requestCredentialUpdate === true) {
      return <RequestCredentialUpdate />;
    }

    if (state?.reviewCredentialUpdate === true) {
      return <ReviewCredentialUpdate />;
    }

  };

  // Key names an active flag rather than any content from the view itself, so AnimatePresence
  // treats switching between views as a transition, but re-renders of the same view (e.g. a
  // token prop changing) don't replay the animation.
  const activeViewKey = [
    'showMidnightWallet', 'createPoap', 'createEvent', 'createIssuer', 'createMint', 'getHolderKey',
    'showSubscribers', 'showBlockchainInfo', 'publishDisclosureRequest', 'showBackup', 'proveOwnership', 'showHolderProofs', 'burnToken', 'showLinkQr', 'showProofHistory', 'showOrganizerProfile',
    'requestCredentialUpdate', 'reviewCredentialUpdate',
  ].find((flag) => state?.[flag] === true) || 'none';

  // CLOSE_DRAWER flips every view flag to false in the same dispatch as `open: false` (see the
  // reducer), so activeViewKey goes straight to 'none' the instant a close starts — before the
  // fade-out transition has even begun. Deriving the outer chrome (lateral vs. modal, solid vs.
  // glass, slide vs. fade) straight from that live key would snap it back to the lateral drawer's
  // geometry for a frame while it's still animating away. Track the last real view in a ref
  // (mutated during render, not an effect, so there's no extra render/lag) and keep using it for
  // the chrome once we're closing — activeViewKey itself still drives AnimatePresence's key so the
  // exit animation actually fires.
  const lastViewKeyRef = useRef(activeViewKey);
  if (activeViewKey !== 'none') {
    lastViewKeyRef.current = activeViewKey;
  }
  const isOpen = state?.open === true;
  const chromeViewKey = isOpen ? activeViewKey : lastViewKeyRef.current;

  // The solid tone only ever applied to the removed Cardano views (wallet, createSoul*); every
  // remaining view is either a centered modal (whose own rule overrides the tone class anyway) or
  // a lateral glass drawer.
  const drawerTone = 'drawer-glass';

  // Views that opt out of the shared lateral drawer-cart layout in favor of a centered modal (see
  // .drawer-modal in theme-dark-glass.css) — every other view keeps sliding in from the side.
  // Started as just the Midnight wallet-connect popup; the four create/claim/mint forms joined it
  // once they got the same glass-popup treatment (short forms, don't need a full-height side
  // panel).
  const MODAL_VIEWS = [
    'showMidnightWallet', 'createPoap', 'createEvent', 'createIssuer', 'createMint', 'getHolderKey',
    'showSubscribers', 'showBlockchainInfo', 'publishDisclosureRequest', 'showBackup', 'proveOwnership', 'showHolderProofs', 'burnToken', 'showLinkQr', 'showProofHistory', 'showOrganizerProfile',
    'requestCredentialUpdate', 'reviewCredentialUpdate',
  ];
  const isModalView = MODAL_VIEWS.includes(chromeViewKey);
  const drawerLayout = isModalView ? 'drawer-modal' : 'drawer-cart';

  // createEvent's metadata step (name/description/image dropzone/crop) needs real horizontal room
  // for a 2-column layout, and showSubscribers lists one row per holder — both stay cramped at the
  // shared narrow modal width, unlike every other (short-form) modal view.
  const isWideModalView = chromeViewKey === 'createEvent' || chromeViewKey === 'showSubscribers';

  // Translucent/glass form-control treatment (see .drawer-modal-glass-form in
  // theme-dark-glass.css) instead of the default solid --solid-bg fill — explicitly requested for
  // createEvent, then extended to createMint (mintPoap.jsx) and getHolderKey once their own inputs
  // got the same "reads as a plain black box" feedback (Get My Key is opened from
  // mySubscriptions.jsx/poapCard.jsx context). Independent of isWideModalView — this only swaps
  // input colors, doesn't touch modal width.
  const isGlassFormView = ['createEvent', 'createMint', 'getHolderKey', 'publishDisclosureRequest', 'showOrganizerProfile'].includes(chromeViewKey);

  // Every centered popup: its text and icons get a crisp 1px dark fill so they stay readable over
  // light images. See .drawer-modal-legible in theme-dark-glass.css.

  const closeDrawer = () => dispatch({ type: 'CLOSE_DRAWER' });

  // The modal's own fade is handled by the outer .drawer-modal's CSS opacity transition (driven
  // by the .open class) — modal-view content stays fully opaque here so there's only ever one
  // opacity animation running, not two independently-timed fades (this framer-motion one plus the
  // CSS one) stacking and visibly flickering against each other. Every other view still gets its
  // own x-slide fade since those don't have an outer CSS fade to double up with.
  const contentMotion = isModalView
    ? { initial: { opacity: 1 }, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : { initial: { opacity: 0, x: 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: 16 } };

  return (

    <React.Fragment>
      {/* Gated on live isOpen, not the sticky chrome-view ref used below — that ref stays on the
          last real modal view forever after the modal's first open (on purpose, so the closing
          .drawer doesn't snap back to the lateral layout mid-fade-out), so gating this on it
          instead would leave a full-viewport transparent click-catcher mounted forever after the
          first close, silently blocking every click on the rest of the app until a hard refresh. */}
      {isOpen && isModalView && (
        <div
          className="drawer-modal-overlay"
          onClick={closeDrawer}
          aria-hidden="true"
        ></div>
      )}
      <div className={`drawer ${drawerLayout} ${drawerTone} ${isWideModalView ? 'drawer-modal-wide' : ''} ${isGlassFormView ? 'drawer-modal-glass-form' : ''} ${isModalView ? 'drawer-modal-legible' : ''} ${isOpen ? 'open' : ''}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeViewKey}
            className={isModalView ? 'drawer-modal-motion' : undefined}
            {...contentMotion}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
          >
            {drawerComponent(state)}
          </motion.div>
        </AnimatePresence>
      </div>
    </React.Fragment>

  );
};
