import { useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";

import Shell from "./components/Shell";
import ArchivePage from "./pages/Archive";
import EvidencePage from "./pages/Evidence";
import OverviewPage from "./pages/Overview";
import PipelinePage from "./pages/Pipeline";
import RunsPage from "./pages/Runs";

function ScrollToTop() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="page">
      <div className="page-head__kicker micro">404 / case missing</div>
      <h1 className="page-head__title">This page is <em>not in the file.</em></h1>
      <p className="page-head__lede">The route does not exist. Return to the desk or open the evidence index.</p>
      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <Link className="button" to="/">back to desk</Link>
        <Link className="button button--ghost" to="/evidence">open evidence</Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<OverviewPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="evidence" element={<EvidencePage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
