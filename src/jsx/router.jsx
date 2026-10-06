import { useEffect, useCallback } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/index";
import AppHome from "./pages/appHome";
import SettingsProfile from "./pages/settings-profile";
import Search from "./pages/search";
import { Drawer } from "./drawer/drawer";
import { useDrawerDispatch } from "./contexts/drawer/drawer.provider";
import ClaimMint from "./pages/claim-mint";
import { getAllEvents } from "../midnight/indexer.service";
import MyEvents from "./pages/myEvents";
import ExploreEvents from "./pages/exploreEvents";
import MySubscriptions from "./pages/mySubscriptions";
import Overview from "./pages/overview";
import OrganizerDashboard from "./pages/organizerDashboard";
import SharedCollection from "./pages/sharedCollection";
import OrganizerInfo from "./pages/organizerInfo";
import SubscriberInfo from "./pages/subscriberInfo";
import Docs from "./pages/docs";
import AdminDeploy from "./pages/adminDeploy";
import CredentialImport from "./pages/credentialImport";
import VerifyProof from "./pages/verifyProof";
import KeyInvite from "./pages/keyInvite";
import MintLink from "./pages/mintLink";
import RequestLink from "./pages/requestLink";

const Router = () => {
  const dispatch = useDrawerDispatch();
  const updateEvents = useCallback((events) => {
    dispatch({
      type: "UPDATE_EVENTS",
      payload: events,
    });
  }, [dispatch]);

  useEffect(() => {
    async function fetchData() {
      try {
        const events = await getAllEvents();
        updateEvents(events);
      } catch (error) {
        console.error("Error loading events:", error);
      }
    }
    fetchData();
  }, [updateEvents]);

  return (
    <BrowserRouter>
      <Drawer />

      {/* <BrowserRouter> */}
      <div id="main-wrapper">
        <Routes>
          {/* Landing (marketing/onboarding) — everything else below lives under /app. */}
          <Route path="/" exact element={<Dashboard />} />
          <Route path="/organizer" element={<OrganizerInfo />} />
          <Route path="/subscriber" element={<SubscriberInfo />} />
          <Route path="/docs" element={<Docs />} />

          {/* App */}
          <Route path="/app" element={<AppHome />} />
          <Route path="/app/overview" element={<Overview />} />
          <Route path="/app/search" element={<Search />} />
          <Route path="/app/my-events" element={<MyEvents />} />
          <Route path="/app/explore-events" element={<ExploreEvents />} />
          <Route path="/app/my-subscriptions" element={<MySubscriptions />} />
          {/* No nav link points here anymore — deliberately shelved rather than deleted, for a
              possible future organizer-analytics view. Reachable only by typing the URL directly. */}
          <Route path="/app/organizer-dashboard" element={<OrganizerDashboard />} />
          {/* Admin-only, gated inside the page itself (REACT_APP_ADMIN_WALLET_ADDRESSES) — not
              linked from any nav menu, same reasoning as /app/organizer-dashboard above. */}
          <Route path="/app/admin/deploy" element={<AdminDeploy />} />
          <Route path="/app/share" element={<SharedCollection />} />
          {/* Older links carried the wallet address in the path; it's ignored now (see collection-share.ts). */}
          <Route path="/app/share/:pkHex" element={<SharedCollection />} />
          <Route path="/app/Settings-profile" element={<SettingsProfile />} />
          <Route path="/app/claim-mint" element={<ClaimMint />} />
          <Route path="/app/credential" element={<CredentialImport />} />
          <Route path="/app/verify" element={<VerifyProof />} />
          <Route path="/app/key" element={<KeyInvite />} />
          <Route path="/app/mint" element={<MintLink />} />
          <Route path="/app/request" element={<RequestLink />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
};

export default Router;
