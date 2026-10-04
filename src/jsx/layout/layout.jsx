import { Fragment, useEffect } from "react";
import Header from "./header";
import BottomNav from "./BottomNav";
import { useSiteRole } from "../hooks/useSiteRole";
// `activeMenu` is accepted for backwards compatibility with existing page call sites
// (<Layout activeMenu={N}>) but no longer used — Header derives its active nav link from the
// URL itself (see header.jsx), not this fragile numeric id.
const Layout = ({ children, activeMenu }) => {
  const [role] = useSiteRole();

  // Every app page renders through this Layout, so this is the one place a role-organizer/
  // -subscriber class can reach the page's actual scroll root — needed so the native scrollbar
  // thumb (theme-dark-glass.css) can be tinted by the current role. Applied to BOTH <html> and
  // <body>: a <html>-only version was tried first (the class Chrome's page-level
  // ::-webkit-scrollbar pseudo-elements are "supposed to" key off, per how a plain page with no
  // explicit overflow on body scrolls) but the scrollbar thumb stayed on the unscoped default
  // gradient regardless, so this covers both rather than relying on one specific assumption about
  // which element's pseudo-element Chrome is actually rendering. Any other "tint the whole app by
  // current role" rule could hook into either class.
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove("role-organizer", "role-subscriber");
    body.classList.remove("role-organizer", "role-subscriber");
    root.classList.add(`role-${role}`);
    body.classList.add(`role-${role}`);
    return () => {
      root.classList.remove(`role-${role}`);
      body.classList.remove(`role-${role}`);
    };
  }, [role]);

  return (
    <Fragment>
      <Header />

      <div className="content-body app-content-body">
        <div className="container">{children}</div>
      </div>

      {/* Phone-only fade behind the bottom bar (theme-dark-glass.css). A sibling, not part of the
          bar: the bar has its own backdrop-filter, so a blur nested inside it couldn't reach the page. */}
      <div className="bottom-nav-backdrop" aria-hidden="true" />
      <BottomNav />
    </Fragment>
  );
};
export default Layout;
