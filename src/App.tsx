import { useEffect, useState } from "react";
import { fetchHealth } from "./api";

// The shell of the library UI: it proves the browser can reach the gateway and
// leaves the catalogue itself to the tickets that follow.
export default function App() {
  const [status, setStatus] = useState("checking…");

  useEffect(() => {
    fetchHealth()
      .then((health) => setStatus(health.status))
      .catch(() => setStatus("unreachable"));
  }, []);

  return (
    <main>
      <h1>Library</h1>
      <p>
        Gateway: <strong>{status}</strong>
      </p>
    </main>
  );
}
