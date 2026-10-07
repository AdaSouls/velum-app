import { createContext, useContext, useReducer, useEffect } from 'react';
import useMidnight from './useMidnight';

const DrawerContext = createContext(null);
const DrawerDispatchContext = createContext(null);

export function DrawerProvider({ children }) {
  const midnightState = useMidnight();

  const initialState = {
    midnight: midnightState,
    showMidnightWallet: false,
    createPoap: false,
    createEvent: false,
    createIssuer: false,
    createMint: false,
    getHolderKey: false,
    showSubscribers: false,
    showBlockchainInfo: false,
    publishDisclosureRequest: false,
    showBackup: false,
    proveOwnership: false,
    showHolderProofs: false,
    burnToken: false,
    showLinkQr: false,
    showProofHistory: false,
    showOrganizerProfile: false,
    requestCredentialUpdate: false,
    reviewCredentialUpdate: false,
    open: false,
    poapEvents: [],
    poapCollection: [],
    poapIssuer: null,
  };

  const [state, dispatch] = useReducer(
    drawerReducer,
    initialState
  );

  // useReducer only reads `initialState` once, on mount — after that, `state.midnight` only
  // changes when something dispatches UPDATE_MIDNIGHT_WALLET. Mirrors useMidnight()'s own live
  // `provider` state into the reducer on every change so useDrawer() consumers (header.jsx,
  // mySubscriptions.jsx, etc.) don't keep reading the stale `provider: null` from the initial
  // render forever.
  useEffect(() => {
    dispatch({ type: 'UPDATE_MIDNIGHT_WALLET', payload: midnightState.provider });
  }, [midnightState.provider]);

  // Same staleness problem as above, for the hook's other two fields — without this,
  // midnight.connecting/midnight.error as read via useDrawer() (e.g. laceWallet.jsx's loading
  // state) never reflect useMidnight()'s live values, since useReducer's initialState snapshot is
  // the only place they were ever set.
  useEffect(() => {
    dispatch({
      type: 'UPDATE_MIDNIGHT_STATUS',
      payload: { connecting: midnightState.connecting, error: midnightState.error },
    });
  }, [midnightState.connecting, midnightState.error]);

  return (
    <DrawerContext.Provider value={state}>
      <DrawerDispatchContext.Provider value={dispatch}>
        {children}
      </DrawerDispatchContext.Provider>
    </DrawerContext.Provider>
  );
}

export function useDrawer() {
  return useContext(DrawerContext);
}

export function useDrawerDispatch() {
  return useContext(DrawerDispatchContext);
}


function drawerReducer(state, action) {
  switch (action.type) {
    case 'UPDATE_MIDNIGHT_WALLET':
      return {
        ...state,
        midnight: {
          ...state.midnight,
          provider: action.payload
        }
      };
    case 'UPDATE_MIDNIGHT_STATUS':
      return {
        ...state,
        midnight: {
          ...state.midnight,
          ...action.payload
        }
      };
    case 'SHOW_MIDNIGHT_WALLET':
      return {
        ...state,
        showMidnightWallet: true,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'CREATE_MINT':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: true,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        mintEvent: action.payload,
        // Holder code from a mint link (mintLink.jsx), pre-filled as the recipient.
        mintRecipient: action.recipient || null
      };
    case 'GET_HOLDER_KEY':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: true,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'SHOW_SUBSCRIBERS':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: true,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        subscribers: action.payload
      };
    case 'SHOW_BLOCKCHAIN_INFO':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: true,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        blockchainInfo: action.payload
      };
    case 'SHOW_HOLDER_PROOFS':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: true,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        holderProofsContext: action.payload
      };
    case 'SHOW_PROVE_OWNERSHIP':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: true,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        ownershipProof: action.payload
      };
    case 'SHOW_BURN_TOKEN':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: true,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        burnTokenContext: action.payload
      };
    case 'SHOW_PROOF_HISTORY':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: true,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        proofHistoryContext: action.payload
      };
    case 'SHOW_LINK_QR':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: true,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        linkQr: action.payload
      };
    case 'SHOW_BACKUP':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: true,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'SHOW_ORGANIZER_PROFILE':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: true,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'PUBLISH_DISCLOSURE_REQUEST':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: true,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        disclosureEvent: action.payload
      };
    case 'SHOW_REQUEST_UPDATE':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: true,
        reviewCredentialUpdate: false,
        open: true,
        requestUpdateContext: action.payload
      };
    case 'SHOW_REVIEW_UPDATE':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: true,
        open: true,
        reviewUpdateContext: action.payload
      };
    case 'CLOSE_DRAWER':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: false
      };
    case 'CREATE_POAP':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: true,
        createEvent: false,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true,
        claimEvent: action.payload
      };
    case 'CREATE_EVENT':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: true,
        createIssuer: false,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'CREATE_ISSUER':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: true,
        createOwner: false,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'CREATE_OWNER':
      return {
        ...state,
        showMidnightWallet: false,
        createPoap: false,
        createEvent: false,
        createIssuer: false,
        createOwner: true,
        createMint: false,
        getHolderKey: false,
        showSubscribers: false,
        showBlockchainInfo: false,
        publishDisclosureRequest: false,
        showBackup: false,
        proveOwnership: false,
        showHolderProofs: false,
        burnToken: false,
        showLinkQr: false,
        showProofHistory: false,
        showOrganizerProfile: false,
        requestCredentialUpdate: false,
        reviewCredentialUpdate: false,
        open: true
      };
    case 'UPDATE_EVENTS':
      return {
        ...state,
        poapEvents: action.payload
      };
    case 'UPDATE_ISSUER':
      return {
        ...state,
        poapIssuer: action.payload
      };
    case 'UPDATE_OWNER':
      return {
        ...state,
        poapOwner: action.payload
      };
    case 'UPDATE_POAPS':
      return {
        ...state,
        poapCollection: action.payload
      };
    default:
      return state;
  }
}
