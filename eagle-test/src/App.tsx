// src/App.jsx (Example Usage)
import { Router, Route } from "@solidjs/router";
import ProductCard from "./components/product";
import { logger } from "./utils";
import LogDashboard from "./pages/dashboard";
import ProductPage from "./pages/product";

const App = () => {
  logger.info("Dynamically updating log collector config...");

  //   setTimeout(() => {
  //     console.log("Dynamically updating log collector config...");
  //     logger.updateConfig({
  //       logLevel: "info", // Now only capture info and above
  //       batchSize: 20, // Send larger batches
  //       samplingRates: {
  //         info: 0.8, // Adjust info logs sampling
  //         warn: 1.0, // Ensure all warnings are captured
  //       },
  //       maxLogsPerMinute: 100, // Set a new rate limit
  //     });
  //     logger.debug("This debug log will likely be ignored now."); // Won't be captured
  //     logger.info("This info log will be captured with the new sampling rate.");
  //   }, 10000); // After 10 seconds

  return (
    <Router>
      <Route path={"/dashboard"} component={LogDashboard} />
      <Route path={"/product"} component={ProductPage} />
    </Router>
  );
};

export default App;
