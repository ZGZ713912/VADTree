import { useEffect } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";

import Shell from "./components/Shell";
import ArchivePage from "./pages/Archive";
import EvidencePage from "./pages/Evidence";
import OverviewPage from "./pages/Overview";
import PipelinePage from "./pages/Pipeline";
import QueryPage from "./pages/Query";
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
      <div className="page-head__kicker micro">404 / 卷宗中没有这一页</div>
      <h1 className="page-head__title">这一页，<em>不在卷宗里。</em></h1>
      <p className="page-head__lede">当前路由不存在。回到案头，或打开证据索引。</p>
      <div style={{ marginTop: 24, display: "flex", gap: 12 }}>
        <Link className="button" to="/">回到案头</Link>
        <Link className="button button--ghost" to="/evidence">打开证据</Link>
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
          <Route path="query" element={<QueryPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="archive" element={<ArchivePage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
