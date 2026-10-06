import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ethers } from "ethers";
import abi from "./contractAbi.json";
import addresses from "./contract-address.json";
import "bootstrap/dist/css/bootstrap.min.css";
import "./style.css";

const statuses = [
  "Waiting for oracle",
  "Payment received",
  "Condition not met",
];
const short = (a) =>
  a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "Not connected";

function App() {
  const [account, setAccount] = useState("");
  const [protocol, setProtocol] = useState(null);
  const [vault, setVault] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [liquidity, setLiquidity] = useState("0");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    type: "0",
    eventName: "AI 101",
    threshold: "180",
    payout: "1",
    premium: "0.05",
  });
  const [deposit, setDeposit] = useState("2");

  async function load(
    contract = protocol,
    vaultContract = vault,
    user = account,
  ) {
    if (!contract || !vaultContract) return;
    const count = Number(await contract.nextPolicyId());
    const rows = await Promise.all(
      [...Array(count).keys()].map(async (id) => {
        const policy = await contract.getPolicy(id);
        // Ethers Result named fields are not enumerable, so copy them explicitly.
        return {
          id,
          customer: policy.customer,
          eventName: policy.eventName,
          policyType: policy.policyType,
          threshold: policy.threshold,
          payoutAmount: policy.payoutAmount,
          premium: policy.premium,
          verifiedValue: policy.verifiedValue,
          reportsReceived: policy.reportsReceived,
          status: policy.status,
        };
      }),
    );
    const visiblePolicies = user
      ? rows.filter((p) => p.customer.toLowerCase() === user.toLowerCase())
      : rows;
    setPolicies(visiblePolicies);
    setLiquidity(ethers.formatEther(await vaultContract.availableLiquidity()));
    // Show a friendly receipt once when the current user first sees a completed payout.
    const newlyPaid = visiblePolicies.find((p) => {
      const receiptKey = `payout-receipt-${addresses.protocol}-${p.id}`;
      return (
        Number(p.status) === 1 && !window.sessionStorage.getItem(receiptKey)
      );
    });
    if (newlyPaid) {
      window.sessionStorage.setItem(
        `payout-receipt-${addresses.protocol}-${newlyPaid.id}`,
        "shown",
      );
      setMessage(
        `Good news! You received ${ethers.formatEther(
          newlyPaid.payoutAmount,
        )} ETH for ${
          newlyPaid.eventName
        }. The payout was sent automatically to your connected wallet.`,
      );
    }
  }

  async function connect() {
    try {
      if (!window.ethereum) throw new Error("MetaMask is not installed.");
      if (!addresses.protocol || !addresses.vault)
        throw new Error("Deploy contracts first: npm run deploy");
      const browser = new ethers.BrowserProvider(window.ethereum);
      await browser.send("eth_requestAccounts", []);
      const network = await browser.getNetwork();
      if (Number(network.chainId) !== addresses.chainId)
        throw new Error("Switch MetaMask to Localhost 8545 (chain id 31337).");
      const signer = await browser.getSigner();
      const p = new ethers.Contract(addresses.protocol, abi, signer);
      const v = new ethers.Contract(addresses.vault, abi, signer);
      setAccount(await signer.getAddress());
      setProtocol(p);
      setVault(v);
      setMessage("Wallet connected.");
      await load(p, v, await signer.getAddress());
    } catch (e) {
      setMessage(e.shortMessage || e.message);
    }
  }

  // MetaMask remembers approved sites. Restore that connection after a browser refresh.
  useEffect(() => {
    async function restoreConnection() {
      try {
        if (!window.ethereum || !addresses.protocol || !addresses.vault) return;
        const approvedAccounts = await window.ethereum.request({
          method: "eth_accounts",
        });
        if (!approvedAccounts.length) return;
        const browser = new ethers.BrowserProvider(window.ethereum);
        const network = await browser.getNetwork();
        if (Number(network.chainId) !== addresses.chainId) return;
        const signer = await browser.getSigner();
        const p = new ethers.Contract(addresses.protocol, abi, signer);
        const v = new ethers.Contract(addresses.vault, abi, signer);
        const user = await signer.getAddress();
        setAccount(user);
        setProtocol(p);
        setVault(v);
        await load(p, v, user);
      } catch (e) {
        console.warn("Could not restore wallet", e);
      }
    }
    restoreConnection();
  }, []);

  // Keep the screen in sync if the user locks MetaMask or changes the selected account.
  useEffect(() => {
    if (!window.ethereum) return undefined;
    const accountChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        setAccount("");
        setProtocol(null);
        setVault(null);
        setPolicies([]);
        setMessage("Wallet disconnected. Connect MetaMask to continue.");
      } else if (
        account &&
        accounts[0].toLowerCase() !== account.toLowerCase()
      ) {
        window.location.reload();
      }
    };
    const networkChanged = () => window.location.reload();
    window.ethereum.on("accountsChanged", accountChanged);
    window.ethereum.on("chainChanged", networkChanged);
    return () => {
      window.ethereum.removeListener("accountsChanged", accountChanged);
      window.ethereum.removeListener("chainChanged", networkChanged);
    };
  }, [account]);

  async function buy(e) {
    e.preventDefault();
    try {
      if (!protocol) throw new Error("Connect wallet first.");
      setMessage("Waiting for policy purchase transaction...");
      const tx = await protocol.createPolicy(
        form.eventName,
        Number(form.type),
        BigInt(form.threshold),
        ethers.parseEther(form.payout),
        { value: ethers.parseEther(form.premium) },
      );
      setMessage(`Policy transaction sent: ${tx.hash}`);
      await tx.wait();
      setMessage(`Policy created successfully. Tx: ${tx.hash}`);
      await load();
    } catch (e) {
      setMessage(e.shortMessage || e.message);
    }
  }

  async function addLiquidity(e) {
    e.preventDefault();
    try {
      const tx = await vault.deposit({ value: ethers.parseEther(deposit) });
      setMessage(`Liquidity transaction sent: ${tx.hash}`);
      await tx.wait();
      setMessage(`Liquidity added. Tx: ${tx.hash}`);
      await load();
    } catch (e) {
      setMessage(e.shortMessage || e.message);
    }
  }
  useEffect(() => {
    if (protocol) load();
  }, [protocol]);
  useEffect(() => {
    if (!message) return undefined;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);
  const unit = form.type === "0" ? "minutes delay" : "weather severity score";
  const activePolicies = policies.filter((p) => Number(p.status) === 0).length;
  const paidPolicies = policies.filter((p) => Number(p.status) === 1).length;
  const totalCover = policies.reduce((sum, p) => sum + p.payoutAmount, 0n);
  return (
    <main className="container py-4">
      <header className="hero-card">
        <div>
          <p className="course-label">BLOCKCHAIN PROJECT</p>
          <h1>Parametric Insurance Protocol</h1>
          <p className="sub">
            Simple decentralized cover for flight delays.
          </p>
        </div>
        <div className="wallet-action">
          <span
            className={`connection-state ${account ? "online" : "offline"}`}
          >
            <i></i>
            {account ? "Wallet connected" : "Wallet not connected"}
          </span>
          <button className="connect btn btn-light" onClick={connect}>
            Connect MetaMask
          </button>
        </div>
      </header>
      <section className="summary shadow-sm">
        <div>
          <span className="summary-icon">◉</span>
          <span>Connected wallet</span>
          <strong>{short(account)}</strong>
        </div>
        <div>
          <span className="summary-icon">◆</span>
          <span>Available vault liquidity</span>
          <strong>{Number(liquidity).toFixed(3)} ETH</strong>
        </div>
        <div>
          <span className="summary-icon">✓</span>
          <span>Oracle rule</span>
          <strong>2 reports needed</strong>
        </div>
      </section>
      {message && (
        <div className="toast-message" role="alert">
          <div>
            <strong>Protocol update</strong>
            <p>{message}</p>
          </div>
          <button aria-label="Close message" onClick={() => setMessage("")}>
            ×
          </button>
        </div>
      )}
      <section className="dashboard-overview">
        <div className="overview-heading">
          <div>
            <p className="eyebrow">LIVE PROTOCOL OVERVIEW</p>
            <h2>Your insurance dashboard</h2>
          </div>
          <span className="chain-pill">
            <i></i> Localhost 31337
          </span>
        </div>
        <div className="metrics">
          <div>
            <span>Policies created</span>
            <strong>{policies.length}</strong>
            <small>From this wallet</small>
          </div>
          <div>
            <span>Awaiting oracle</span>
            <strong>{activePolicies}</strong>
            <small>Needs 2 reports</small>
          </div>
          <div>
            <span>Successful payouts</span>
            <strong>{paidPolicies}</strong>
            <small>Resolved policies</small>
          </div>
          <div>
            <span>Total cover selected</span>
            <strong>{ethers.formatEther(totalCover)} ETH</strong>
            <small>Across listed policies</small>
          </div>
        </div>
      </section>
      <div className="grid">
        <section className="shadow-sm">
          <div className="card-title">
            <span>01</span>
            <div>
              <h2>Buy a policy</h2>
              <p>Create a fixed-payout insurance policy.</p>
            </div>
          </div>
          <form onSubmit={buy}>
            <label>
              Insurance type
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="0">Flight delay</option>
                <option value="1">Weather event</option>
              </select>
            </label>
            <label>
              {form.type === "0" ? "Flight number" : "Location / weather event"}
              <input
                value={form.eventName}
                onChange={(e) =>
                  setForm({ ...form, eventName: e.target.value })
                }
              />
            </label>
            <label>
              Threshold ({unit})
              <input
                type="number"
                min="1"
                value={form.threshold}
                onChange={(e) =>
                  setForm({ ...form, threshold: e.target.value })
                }
              />
            </label>
            <label>
              Payout amount (ETH)
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.payout}
                onChange={(e) => setForm({ ...form, payout: e.target.value })}
              />
            </label>
            <label>
              Premium (ETH)
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={form.premium}
                onChange={(e) => setForm({ ...form, premium: e.target.value })}
              />
            </label>
            <button className="w-100 mt-2">
              Pay premium and create policy
            </button>
          </form>
        </section>
        <section className="shadow-sm">
          <div className="card-title">
            <span>02</span>
            <div>
              <h2>Liquidity provider</h2>
              <p>Fund automatic insurance payouts.</p>
            </div>
          </div>
          <form onSubmit={addLiquidity}>
            <label>
              Deposit amount (ETH)
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </label>
            <button className="w-100 mt-2">Add liquidity</button>
          </form>
          <div className="tip">
            <strong>Tip:</strong> keep the vault balance above your policy
            payout amount.
          </div>
        </section>
      </div>
      <section className="shadow-sm">
        <div className="section-heading">
          <div>
            <h2>My policies</h2>
            <p>Policies belonging to the connected wallet.</p>
          </div>
          <button
            className="small-button btn btn-outline-primary"
            onClick={() => window.location.reload()}
          >
            Refresh data
          </button>
        </div>
        {policies.length === 0 ? (
          <p className="empty">
            No policy found for this wallet. Create one above to begin.
          </p>
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Condition</th>
                  <th>Oracle result</th>
                  <th>Result</th>
                  <th>Payout</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id}>
                    <td>#{p.id}</td>
                    <td>
                      <strong>{p.eventName}</strong>
                    </td>
                    <td>
                      <span className="type-label">
                        {Number(p.policyType) === 0 ? "✈ Flight" : "☁ Weather"}
                      </span>
                    </td>
                    <td>≥ {p.threshold.toString()}</td>
                    <td>
                      <div className="report-progress">
                        <span
                          style={{
                            width: `${Number(p.reportsReceived) * 50}%`,
                          }}
                        ></span>
                      </div>
                      {p.reportsReceived.toString()}/2 reports{" "}
                      <small>• Value: {p.verifiedValue.toString()}</small>
                    </td>
                    <td>
                      <span className={`status status-${Number(p.status)}`}>
                        {statuses[Number(p.status)]}
                      </span>
                    </td>
                    <td>
                      <strong>{ethers.formatEther(p.payoutAmount)} ETH</strong>
                      {Number(p.status) === 1 && (
                        <small className="received-mark">
                          ✓ Received in wallet
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <footer>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<App />);
