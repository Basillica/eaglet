import { Router, Route } from "@solidjs/router";
import { logger } from "./utils";
import LogDashboard from "./pages/dashboard";
import ProductPage from "./pages/product";

const App = () => {
  logger.info("Dynamically updating log collector config...");

  return (
    <Router>
      <Route path={"/dashboard"} component={LogDashboard} />
      <Route path={"/product"} component={ProductPage} />
    </Router>
  );
};

export default App;
