"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronDown, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Decision = {
  allowed: boolean;
  code: string;
  profile?: { countryCode?: string } | null;
  limits?: { cooldownUntil?: number | null; selfExcludedUntil?: number | null } | null;
};
type Restriction = { action: "cooldown" | "self_exclude"; duration: number; label: string };
type PrivacyReceipt = { type: string; id: string; status: string };

const COUNTRY_CODES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");

function formatDate(value?: number | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(value * 1000) : null;
}

async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as T & { code?: string };
    if (!response.ok) throw new Error(payload.code === "UNAUTHENTICATED" ? "Your wallet session expired. Reconnect and try again." : payload.code ?? "The request could not be completed.");
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("The request timed out. Check the service and try again.");
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function ComplianceCenter({ authenticated, walletAddress }: { authenticated: boolean; walletAddress: string | null }) {
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [country, setCountry] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const [countryListOpen, setCountryListOpen] = useState(false);
  const [checks, setChecks] = useState({ age: false, terms: false, privacy: false, risk: false });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingRestriction, setPendingRestriction] = useState<Restriction | null>(null);
  const [privacyReceipts, setPrivacyReceipts] = useState<PrivacyReceipt[]>([]);
  const modalRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const displayNames = useMemo(() => new Intl.DisplayNames(["en"], { type: "region" }), []);
  const countries = useMemo(() => COUNTRY_CODES.map(code => ({ code, name: displayNames.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name)), [displayNames]);
  const filteredCountries = useMemo(() => {
    const query = countrySearch.trim().toLowerCase();
    return countries.filter(item => !query || item.code.toLowerCase().includes(query) || item.name.toLowerCase().includes(query)).slice(0, 12);
  }, [countries, countrySearch]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setCountryListOpen(false);
    setPendingRestriction(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }, []);
  const openModal = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!authenticated) { setDecision(null); return; }
    try {
      const payload = await apiRequest<{ decision: Decision }>("/api/compliance/profile", { cache: "no-store" });
      setDecision(payload.decision);
      const code = payload.decision.profile?.countryCode ?? "";
      setCountry(code);
      setCountrySearch(code ? `${displayNames.of(code) ?? code} (${code})` : "");
      if (!payload.decision.allowed) setOpen(true);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Compliance status is unavailable."); }
  }, [authenticated, displayNames]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => { active = false; };
  }, [refresh, walletAddress]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = modalRef.current?.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])");
    first?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeModal(); return; }
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const firstItem = focusable[0]; const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [closeModal, open]);

  async function attest(event: FormEvent) {
    event.preventDefault();
    if (!authenticated) { setStatus("Connect and authenticate a wallet before saving eligibility."); return; }
    setBusy("eligibility"); setStatus("");
    try {
      const payload = await apiRequest<{ decision: Decision }>("/api/compliance/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ countryCode: country, ageConfirmed: checks.age, termsAccepted: checks.terms, privacyAccepted: checks.privacy, riskAccepted: checks.risk }) });
      setDecision(payload.decision); setStatus("Devnet eligibility saved.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Eligibility could not be confirmed."); }
    finally { setBusy(null); }
  }

  async function activateRestriction() {
    if (!pendingRestriction || !authenticated) return;
    const { action, duration } = pendingRestriction;
    setBusy("restriction"); setStatus("");
    try {
      await apiRequest("/api/compliance/responsible-play", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "cooldown" ? { action, hours: duration } : { action, days: duration }) });
      setStatus("Restriction activated immediately."); setPendingRestriction(null); await refresh();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Restriction could not be activated."); }
    finally { setBusy(null); }
  }

  async function requestPrivacy(type: string) {
    if (!authenticated) return;
    setBusy(`privacy-${type}`); setStatus("");
    try {
      const payload = await apiRequest<{ request: { id: string; status: string } }>("/api/compliance/privacy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestType: type }) });
      setPrivacyReceipts(current => [{ type, id: payload.request.id, status: payload.request.status }, ...current.filter(item => item.type !== type)]);
      setStatus(`${type[0].toUpperCase()}${type.slice(1)} request received for human review.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Privacy request could not be submitted."); }
    finally { setBusy(null); }
  }

  function countryKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") setCountryListOpen(false);
    if (event.key === "Enter" && countryListOpen && filteredCountries[0]) { event.preventDefault(); selectCountry(filteredCountries[0]); }
  }
  function selectCountry(item: { code: string; name: string }) { setCountry(item.code); setCountrySearch(`${item.name} (${item.code})`); setCountryListOpen(false); }
  const disabledReason = !authenticated ? "Connect and authenticate your wallet to use account-specific safety and privacy controls." : "";
  const cooldown = formatDate(decision?.limits?.cooldownUntil);
  const exclusion = formatDate(decision?.limits?.selfExcludedUntil);

  return <>
    <button type="button" className="compliance-launcher" onClick={openModal} tabIndex={-1} aria-hidden="true"><ShieldCheck size={15}/> Safety & privacy</button>
    <AnimatePresence>{open && <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}>
      <motion.section ref={modalRef} className="compliance-modal" role="dialog" aria-modal="true" aria-labelledby="compliance-title" initial={{ opacity: 0, y: 16, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: .99 }} onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><div><span>DEVNET SAFETY GATE</span><h2 id="compliance-title">Eligibility and controls</h2></div><button type="button" onClick={closeModal} aria-label="Close compliance center"><X size={18}/></button></div>
        <p>This demonstration uses test SOL only. It is not licensed for real-money gambling and mainnet remains disabled.</p>
        {!decision?.allowed ? <form onSubmit={attest}>
          <label className="country-field">Country or territory
            <span className="country-combobox">
              <input value={countrySearch} onChange={event => { setCountrySearch(event.target.value); setCountry(""); setCountryListOpen(true); }} onFocus={() => setCountryListOpen(true)} onKeyDown={countryKeyDown} placeholder="Search by country or ISO code" role="combobox" aria-expanded={countryListOpen} aria-controls="country-options" aria-autocomplete="list" autoComplete="off" />
              <ChevronDown size={17}/>
              {countryListOpen && <span className="country-options" id="country-options" role="listbox">{filteredCountries.length ? filteredCountries.map(item => <button type="button" role="option" aria-selected={country === item.code} key={item.code} onMouseDown={event => event.preventDefault()} onClick={() => selectCountry(item)}><span>{item.name}</span><b>{item.code}</b></button>) : <em>No matching country</em>}</span>}
            </span>
          </label>
          {([['age','I confirm I am at least 18 years old.'],['terms','I accept the Terms and game rules.'],['privacy','I have read the Privacy Notice.'],['risk','I understand randomness, loss risk, and that this is devnet.']] as const).map(([key,label]) => <label className="compliance-check" key={key}><input type="checkbox" checked={checks[key]} onChange={event => setChecks(current => ({ ...current, [key]: event.target.checked }))}/><span>{label}</span></label>)}
          <div className="compliance-links"><a href="/legal#terms">Terms</a><a href="/legal#privacy">Privacy</a><a href="/legal#responsible-play">Responsible play</a></div>
          {!authenticated && <p className="control-explanation">{disabledReason}</p>}
          <button className="primary" disabled={!authenticated || busy !== null || !COUNTRY_CODES.includes(country) || Object.values(checks).some(value => !value)}>{busy === "eligibility" ? <><LoaderCircle className="spin" size={16}/> Saving…</> : "Confirm devnet eligibility"}</button>
        </form> : <div className="compliance-approved"><ShieldCheck/><strong>Devnet eligibility active</strong><span>Country: {decision.profile?.countryCode} · No real-value wagers</span></div>}

        <div className="restriction-actions"><h3>Take a break</h3><p>Restrictions apply immediately to transaction preparation and cannot be shortened while active.</p>
          {(cooldown || exclusion) && <div className="active-restrictions"><CheckCircle2 size={15}/><span>{exclusion ? `Self-excluded until ${exclusion}` : `Cooldown active until ${cooldown}`}</span></div>}
          <button type="button" disabled={!authenticated || busy !== null} onClick={() => setPendingRestriction({ action: "cooldown", duration: 24, label: "24-hour cooldown" })}>24-hour cooldown</button>
          <button type="button" disabled={!authenticated || busy !== null} onClick={() => setPendingRestriction({ action: "cooldown", duration: 168, label: "7-day cooldown" })}>7-day cooldown</button>
          <button type="button" className="danger" disabled={!authenticated || busy !== null} onClick={() => setPendingRestriction({ action: "self_exclude", duration: 180, label: "180-day self-exclusion" })}>Self-exclude for 180 days</button>
          {!authenticated && <p className="control-explanation">{disabledReason}</p>}
          <AnimatePresence>{pendingRestriction && <motion.div className="restriction-confirm" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} role="alertdialog" aria-label="Confirm restriction"><strong>Confirm {pendingRestriction.label}?</strong><span>This starts immediately and cannot be shortened while active.</span><div><button type="button" onClick={() => setPendingRestriction(null)}>Cancel</button><button type="button" className={pendingRestriction.action === "self_exclude" ? "danger" : "confirm"} disabled={busy !== null} onClick={() => void activateRestriction()}>{busy === "restriction" ? "Activating…" : "Activate restriction"}</button></div></motion.div>}</AnimatePresence>
        </div>

        <div className="privacy-actions"><h3>Privacy rights</h3><p>Requests are recorded with a reference ID and sent for human review.</p>{["access", "export", "erasure"].map(type => <button type="button" key={type} disabled={!authenticated || busy !== null || privacyReceipts.some(item => item.type === type)} onClick={() => void requestPrivacy(type)}>{busy === `privacy-${type}` ? "Submitting…" : `${type} request`}</button>)}
          {!authenticated && <p className="control-explanation">{disabledReason}</p>}
          {privacyReceipts.map(receipt => <div className="privacy-receipt" key={receipt.id}><CheckCircle2 size={14}/><span><strong>{receipt.type} · {receipt.status}</strong><small>Reference {receipt.id}</small></span></div>)}
        </div>
        {status && <output className="compliance-status" aria-live="polite">{status}</output>}
      </motion.section>
    </motion.div>}</AnimatePresence>
  </>;
}
