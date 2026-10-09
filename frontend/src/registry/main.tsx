import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider } from "react-router-dom";
import "@shared/base.css";
import "./registry.css";
import Layout from "./Layout";
import Compare from "./pages/Compare";
import Datasets from "./pages/Datasets";
import { Activity, People, System } from "./pages/Misc";
import ModelDetail from "./pages/ModelDetail";
import Models from "./pages/Models";
import Overview from "./pages/Overview";
import { ProjectDetail, Projects } from "./pages/Projects";

function NotFound() {
  return (
    <div className="card empty">
      Nothing here. <Link to="/">Back to overview</Link>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Overview /> },
      { path: "/models", element: <Models /> },
      { path: "/models/:id", element: <ModelDetail /> },
      { path: "/compare", element: <Compare /> },
      { path: "/datasets", element: <Datasets /> },
      { path: "/projects", element: <Projects /> },
      { path: "/projects/:slug", element: <ProjectDetail /> },
      { path: "/people", element: <People /> },
      { path: "/activity", element: <Activity /> },
      { path: "/system", element: <System /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
