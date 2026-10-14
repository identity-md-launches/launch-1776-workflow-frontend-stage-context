import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadRuntime } from "./config";
import { RuntimeProvider } from "./data";
import App from "./App";
import "./styles.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="boot">
    <img src="./favicon.svg" alt="" width="48" height="48" />
    <h1>REKTD arena</h1>
    <p role="status">Loading the verified deployment…</p>
  </div>,
);
loadRuntime()
  .then((runtime) => {
    const query = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
    });
    root.render(
      <StrictMode>
        <WagmiProvider config={runtime.walletConfig}>
          <QueryClientProvider client={query}>
            <RuntimeProvider runtime={runtime}>
              <App />
            </RuntimeProvider>
          </QueryClientProvider>
        </WagmiProvider>
      </StrictMode>,
    );
  })
  .catch((error) =>
    root.render(
      <main className="boot">
        <img src="./favicon.svg" alt="" width="48" height="48" />
        <h1>REKTD arena</h1>
        <p role="alert">{error.message}</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload deployment
        </button>
      </main>,
    ),
  );
